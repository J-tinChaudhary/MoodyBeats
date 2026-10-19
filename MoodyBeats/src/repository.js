"use strict";

const DEFAULT_LIMIT = 12;
const MAX_LIMIT = 50;
const MAX_OFFSET = 1000000;
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SPOTIFY_TRACK_ID_PATTERN = /^[A-Za-z0-9]{22}$/;

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
    SELECT c.id, c.title, c.description, c.symbol, c.color,
           COUNT(cs.song_id)::int AS song_count
    FROM collections c
    LEFT JOIN collection_songs cs ON cs.collection_id = c.id
    GROUP BY c.id
    ORDER BY c.title
  `);
  return result.rows;
}

async function getCollection(pool, id) {
  const result = await pool.query(
    "SELECT id, title, description, symbol, color FROM collections WHERE id = $1",
    [id]
  );
  return result.rows[0] || null;
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
  listSongs,
  getSong,
  listCollections,
  getCollection,
  listFilters,
  spotifyLinks
};
