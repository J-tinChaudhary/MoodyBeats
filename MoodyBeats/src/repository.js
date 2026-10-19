"use strict";

const DEFAULT_LIMIT = 12;
const MAX_LIMIT = 50;
const MAX_OFFSET = 1000000;
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SPOTIFY_TRACK_ID_PATTERN = /^[A-Za-z0-9]{22}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

class InputError extends Error {
  constructor(message) {
    super(message);
    this.name = "InputError";
  }
}

function readQueryValue(query, name, { maxLength = 100, pattern } = {}) {
  const value = query[name];
  if (value === undefined) return null;
  if (typeof value !== "string") {
    throw new InputError(`"${name}" must be supplied once as a text value.`);
  }

  const normalized = value.trim();
  if (normalized.length > maxLength) {
    throw new InputError(`"${name}" must be ${maxLength} characters or fewer.`);
  }
  if (pattern && normalized && !pattern.test(normalized)) {
    throw new InputError(`"${name}" must be a lowercase slug such as "chai-chill".`);
  }
  return normalized || null;
}

function readPagination(query) {
  const rawLimit = readQueryValue(query, "limit", { maxLength: 3 });
  const rawOffset = readQueryValue(query, "offset", { maxLength: 8 });
  const limit = rawLimit === null ? DEFAULT_LIMIT : Number(rawLimit);
  const offset = rawOffset === null ? 0 : Number(rawOffset);

  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
    throw new InputError(`"limit" must be an integer between 1 and ${MAX_LIMIT}.`);
  }
  if (!Number.isInteger(offset) || offset < 0 || offset > MAX_OFFSET) {
    throw new InputError(`"offset" must be an integer between 0 and ${MAX_OFFSET}.`);
  }
  return { limit, offset };
}

function parseSongFilters(query) {
  const pagination = readPagination(query);
  const search = readQueryValue(query, "q");
  const mood = readQueryValue(query, "mood", { maxLength: 40, pattern: SLUG_PATTERN });
  const genre = readQueryValue(query, "genre", { maxLength: 40, pattern: SLUG_PATTERN });
  const collection = readQueryValue(query, "collection", { maxLength: 60, pattern: SLUG_PATTERN });

  return { ...pagination, search, mood, genre, collection };
}

function parseArtistFilters(query) {
  const pagination = readPagination(query);
  if (pagination.limit > 25) {
    throw new InputError('"limit" must be between 1 and 25 for artist discovery.');
  }
  return { ...pagination, search: readQueryValue(query, "q") };
}

function parseEmail(value) {
  if (typeof value !== "string") throw new InputError("Email must be text.");
  const email = value.trim().toLowerCase();
  if (email.length > 254 || !EMAIL_PATTERN.test(email)) {
    throw new InputError("Enter a valid email address.");
  }
  return email;
}

function parsePassword(value) {
  if (typeof value !== "string" || value.length < 12 || Buffer.byteLength(value, "utf8") > 72) {
    throw new InputError("Password must be at least 12 characters and no more than 72 UTF-8 bytes.");
  }
  return value;
}

function parsePlaylistName(value) {
  if (typeof value !== "string") throw new InputError("Playlist name must be text.");
  const name = value.trim();
  if (name.length < 1 || name.length > 80) {
    throw new InputError("Playlist name must contain between 1 and 80 characters.");
  }
  return name;
}

function spotifyLinks(trackId, title, artist) {
  const search = new URL("https://open.spotify.com/search/");
  search.searchParams.set("q", `${title} ${artist}`);

  if (!trackId || !SPOTIFY_TRACK_ID_PATTERN.test(trackId)) {
    return { spotifyUrl: search.toString(), spotifyEmbedUrl: null };
  }

  return {
    spotifyUrl: `https://open.spotify.com/track/${trackId}`,
    spotifyEmbedUrl: `https://open.spotify.com/embed/track/${trackId}`
  };
}

function mapSong(row, collectionIds = []) {
  return {
    id: row.id,
    title: row.title,
    artist: row.artist,
    moods: row.moods,
    genres: row.genres,
    collections: collectionIds,
    spotifyTrackId: row.spotify_track_id,
    ...spotifyLinks(row.spotify_track_id, row.title, row.artist)
  };
}

async function attachCollections(pool, rows) {
  if (rows.length === 0) return [];

  const ids = rows.map(row => row.id);
  const result = await pool.query(
    "SELECT song_id, collection_id FROM collection_songs WHERE song_id = ANY($1::text[]) ORDER BY collection_id",
    [ids]
  );
  const bySong = new Map(ids.map(id => [id, []]));
  result.rows.forEach(row => bySong.get(row.song_id).push(row.collection_id));
  return rows.map(row => mapSong(row, bySong.get(row.id)));
}

function songWhereClause() {
  return `
    WHERE ($1::text IS NULL OR s.title ILIKE '%' || $1 || '%' OR s.artist ILIKE '%' || $1 || '%')
      AND ($2::text IS NULL OR $2 = ANY(s.moods))
      AND ($3::text IS NULL OR $3 = ANY(s.genres))
      AND ($4::text IS NULL OR s.id IN (
        SELECT cs.song_id FROM collection_songs cs WHERE cs.collection_id = $4
      ))
  `;
}

async function listSongs(pool, filters) {
  const filterValues = [filters.search, filters.mood, filters.genre, filters.collection];
  const where = songWhereClause();
  const countResult = await pool.query(
    `SELECT COUNT(*)::int AS total FROM songs s ${where}`,
    filterValues
  );
  const songsResult = await pool.query(
    `SELECT s.id, s.title, s.artist, s.moods, s.genres, s.spotify_track_id
     FROM songs s ${where}
     ORDER BY lower(s.title), s.id
     LIMIT $5 OFFSET $6`,
    [...filterValues, filters.limit, filters.offset]
  );

  return {
    songs: await attachCollections(pool, songsResult.rows),
    pagination: {
      limit: filters.limit,
      offset: filters.offset,
      total: countResult.rows[0].total
    }
  };
}

async function getSong(pool, id) {
  const result = await pool.query(
    "SELECT id, title, artist, moods, genres, spotify_track_id FROM songs WHERE id = $1",
    [id]
  );
  if (result.rowCount === 0) return null;
  return (await attachCollections(pool, result.rows))[0];
}

async function listCollections(pool) {
  const result = await pool.query(`
    SELECT c.id, c.title, c.description, c.symbol, c.color, c.tags,
           COUNT(cs.song_id)::int AS song_count
    FROM collections c
    LEFT JOIN collection_songs cs ON cs.collection_id = c.id
    GROUP BY c.id, c.title, c.description, c.symbol, c.color, c.tags
    ORDER BY c.title
  `);
  return result.rows;
}

async function getCollection(pool, id) {
  const result = await pool.query(
    "SELECT id, title, description, symbol, color, tags FROM collections WHERE id = $1",
    [id]
  );
  return result.rows[0] || null;
}

async function listArtists(pool, filters) {
  const where = "WHERE ($1::text IS NULL OR artist ILIKE '%' || $1 || '%')";
  const count = await pool.query(
    `SELECT COUNT(*)::int AS total FROM (SELECT artist FROM songs ${where} GROUP BY artist) credited_artists`,
    [filters.search]
  );
  const result = await pool.query(
    `SELECT artist AS name, COUNT(*)::int AS song_count
     FROM songs ${where}
     GROUP BY artist
     ORDER BY lower(artist), artist
     LIMIT $2 OFFSET $3`,
    [filters.search, filters.limit, filters.offset]
  );
  return {
    artists: result.rows.map(row => ({ ...row, source: "catalogue-credits" })),
    pagination: { limit: filters.limit, offset: filters.offset, total: count.rows[0].total }
  };
}

async function getUserByEmail(pool, email) {
  const result = await pool.query(
    "SELECT id, email, password_hash FROM users WHERE email = $1",
    [email]
  );
  return result.rows[0] || null;
}

async function createUser(pool, id, email, passwordHash) {
  const result = await pool.query(
    "INSERT INTO users (id, email, password_hash) VALUES ($1, $2, $3) RETURNING id, email",
    [id, email, passwordHash]
  );
  return result.rows[0];
}

async function listFavorites(pool, userId) {
  const result = await pool.query(
    `SELECT s.id, s.title, s.artist, s.moods, s.genres, s.spotify_track_id
     FROM favorites f JOIN songs s ON s.id = f.song_id
     WHERE f.user_id = $1 ORDER BY f.created_at DESC, s.id`,
    [userId]
  );
  return attachCollections(pool, result.rows);
}

async function addFavorite(pool, userId, songId) {
  const result = await pool.query(
    `INSERT INTO favorites (user_id, song_id)
     SELECT $1, id FROM songs WHERE id = $2
     ON CONFLICT (user_id, song_id) DO NOTHING
     RETURNING song_id`,
    [userId, songId]
  );
  if (result.rowCount) return true;
  const song = await pool.query("SELECT 1 FROM songs WHERE id = $1", [songId]);
  return song.rowCount > 0 ? false : null;
}

async function removeFavorite(pool, userId, songId) {
  await pool.query("DELETE FROM favorites WHERE user_id = $1 AND song_id = $2", [userId, songId]);
}

async function listPlaylists(pool, userId) {
  const result = await pool.query(
    `SELECT p.id, p.name, p.created_at, p.updated_at, COUNT(ps.song_id)::int AS song_count
     FROM playlists p LEFT JOIN playlist_songs ps ON ps.playlist_id = p.id
     WHERE p.user_id = $1
     GROUP BY p.id ORDER BY p.updated_at DESC, p.id`,
    [userId]
  );
  return result.rows;
}

async function createPlaylist(pool, id, userId, name) {
  const result = await pool.query(
    "INSERT INTO playlists (id, user_id, name) VALUES ($1, $2, $3) RETURNING id, name, created_at, updated_at",
    [id, userId, name]
  );
  return result.rows[0];
}

async function getPlaylist(pool, userId, playlistId) {
  const result = await pool.query(
    "SELECT id, name, created_at, updated_at FROM playlists WHERE user_id = $1 AND id = $2",
    [userId, playlistId]
  );
  const playlist = result.rows[0];
  if (!playlist) return null;
  const songsResult = await pool.query(
    `SELECT s.id, s.title, s.artist, s.moods, s.genres, s.spotify_track_id
     FROM playlist_songs ps JOIN songs s ON s.id = ps.song_id
     WHERE ps.playlist_id = $1 ORDER BY ps.added_at, s.title`,
    [playlistId]
  );
  const songs = await attachCollections(pool, songsResult.rows);
  return { ...playlist, songs };
}

async function renamePlaylist(pool, userId, playlistId, name) {
  const result = await pool.query(
    `UPDATE playlists SET name = $3, updated_at = NOW()
     WHERE user_id = $1 AND id = $2 RETURNING id, name, created_at, updated_at`,
    [userId, playlistId, name]
  );
  return result.rows[0] || null;
}

async function deletePlaylist(pool, userId, playlistId) {
  const result = await pool.query(
    "DELETE FROM playlists WHERE user_id = $1 AND id = $2 RETURNING id",
    [userId, playlistId]
  );
  return result.rowCount > 0;
}

async function addPlaylistSong(pool, userId, playlistId, songId) {
  const [playlist, song] = await Promise.all([
    pool.query("SELECT 1 FROM playlists WHERE user_id = $1 AND id = $2", [userId, playlistId]),
    pool.query("SELECT 1 FROM songs WHERE id = $1", [songId])
  ]);
  if (playlist.rowCount === 0) return "missing-playlist";
  if (song.rowCount === 0) return "missing-song";

  const result = await pool.query(
    `INSERT INTO playlist_songs (playlist_id, song_id)
     VALUES ($1, $2)
     ON CONFLICT (playlist_id, song_id) DO NOTHING
     RETURNING song_id`,
    [playlistId, songId]
  );
  if (result.rowCount) {
    await pool.query("UPDATE playlists SET updated_at = NOW() WHERE user_id = $1 AND id = $2", [userId, playlistId]);
    return "added";
  }
  return "already-added";
}

async function removePlaylistSong(pool, userId, playlistId, songId) {
  const playlist = await pool.query(
    "SELECT 1 FROM playlists WHERE user_id = $1 AND id = $2",
    [userId, playlistId]
  );
  if (playlist.rowCount === 0) return false;
  const result = await pool.query(
    "DELETE FROM playlist_songs WHERE playlist_id = $1 AND song_id = $2",
    [playlistId, songId]
  );
  return result.rowCount > 0;
}

async function listFilters(pool) {
  const [moodsResult, genresResult] = await Promise.all([
    pool.query("SELECT id, label FROM moods ORDER BY label"),
    pool.query("SELECT id, label FROM genres ORDER BY label")
  ]);
  return { moods: moodsResult.rows, genres: genresResult.rows };
}

module.exports = {
  DEFAULT_LIMIT,
  MAX_LIMIT,
  InputError,
  parseSongFilters,
  parseArtistFilters,
  parseEmail,
  parsePassword,
  parsePlaylistName,
  listSongs,
  getSong,
  listCollections,
  getCollection,
  listFilters,
  spotifyLinks,
  listArtists,
  getUserByEmail,
  createUser,
  listFavorites,
  addFavorite,
  removeFavorite,
  listPlaylists,
  createPlaylist,
  getPlaylist,
  renamePlaylist,
  deletePlaylist,
  addPlaylistSong,
  removePlaylistSong
};
