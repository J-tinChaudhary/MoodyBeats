CREATE TABLE IF NOT EXISTS moods (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS genres (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS collections (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  symbol TEXT NOT NULL,
  color TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS songs (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  artist TEXT NOT NULL,
  moods TEXT[] NOT NULL DEFAULT '{}',
  genres TEXT[] NOT NULL DEFAULT '{}',
  spotify_track_id VARCHAR(22),
  CONSTRAINT spotify_track_id_length
    CHECK (spotify_track_id IS NULL OR spotify_track_id LIKE '______________________')
);

CREATE TABLE IF NOT EXISTS collection_songs (
  collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  song_id TEXT NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
  PRIMARY KEY (collection_id, song_id)
);

CREATE INDEX IF NOT EXISTS songs_title_lower_idx ON songs (lower(title));
CREATE INDEX IF NOT EXISTS songs_artist_lower_idx ON songs (lower(artist));
CREATE INDEX IF NOT EXISTS songs_moods_idx ON songs USING GIN (moods);
CREATE INDEX IF NOT EXISTS songs_genres_idx ON songs USING GIN (genres);
CREATE INDEX IF NOT EXISTS collection_songs_song_id_idx ON collection_songs (song_id);
