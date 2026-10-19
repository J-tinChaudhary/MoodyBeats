"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const { createApp } = require("../src/app");
const { readConfig } = require("../src/config");
const { spotifyLinks } = require("../src/repository");
const testSessionSecret = "a-test-session-secret-with-at-least-32-characters";

const sampleSong = {
  id: "cold-mess",
  title: "Cold/Mess",
  artist: "Prateek Kuhad",
  moods: ["rainy", "heartbreak", "relaxed"],
  genres: ["indie", "acoustic"],
  spotify_track_id: null
};

function createFakePool() {
  const calls = [];
  return {
    calls,
    async query(sql, values = []) {
      calls.push({ sql, values });
      if (sql.trim() === "SELECT 1") return { rows: [{ "?column?": 1 }], rowCount: 1 };
      if (sql.includes("FROM moods")) {
        return { rows: [{ id: "relaxed", label: "Relaxed" }], rowCount: 1 };
      }
      if (sql.includes("FROM genres")) {
        return { rows: [{ id: "indie", label: "Indie" }], rowCount: 1 };
      }
      if (sql.includes("FROM collections c")) {
        return {
          rows: [{ id: "indie", title: "Indie", description: "Thoughtful songs.", symbol: "♫", color: "indie", song_count: 1 }],
          rowCount: 1
        };
      }
      if (sql.includes("FROM collections WHERE id")) {
        return values[0] === "indie"
          ? { rows: [{ id: "indie", title: "Indie", description: "Thoughtful songs.", symbol: "♫", color: "indie" }], rowCount: 1 }
          : { rows: [], rowCount: 0 };
      }
      if (sql.includes("COUNT(*)")) return { rows: [{ total: 1 }], rowCount: 1 };
      if (sql.includes("FROM collection_songs WHERE song_id")) {
        return { rows: [{ song_id: "cold-mess", collection_id: "indie" }], rowCount: 1 };
      }
      if (sql.includes("FROM songs WHERE id")) {
        return values[0] === "cold-mess"
          ? { rows: [sampleSong], rowCount: 1 }
          : { rows: [], rowCount: 0 };
      }
      if (sql.includes("FROM songs s")) {
        return { rows: [sampleSong], rowCount: 1 };
      }
      throw new Error(`Unexpected SQL in test: ${sql}`);
    }
  };
}

function makeTestApp() {
  const pool = createFakePool();
  const loggedErrors = [];
  const app = createApp({
    pool,
    allowedOrigins: new Set(["https://chai.example"]),
    sessionSecret: testSessionSecret,
    logger: { error: (...values) => loggedErrors.push(values) }
  });
  return { app, pool, loggedErrors };
}

const validTestConfig = {
  DATABASE_URL: "postgres://localhost/catalogue",
  SESSION_SECRET: "a-test-secret-that-is-at-least-32-characters"
};

test("configuration requires a PostgreSQL URL and validates the port", () => {
  assert.throws(() => readConfig({}), /DATABASE_URL is required/);
  assert.throws(
    () => readConfig({ ...validTestConfig, DATABASE_URL: "https://example.test", PORT: "3000" }),
    /postgres/
  );
  assert.throws(
    () => readConfig({ ...validTestConfig, PORT: "70000" }),
    /PORT/
  );
  assert.equal(
    readConfig({ ...validTestConfig, PORT: "3001" }).port,
    3001
  );
  assert.throws(
    () => readConfig({ DATABASE_URL: "postgres://localhost/catalogue" }),
    /SESSION_SECRET/
  );
  assert.throws(
    () => readConfig({
      DATABASE_URL: "postgres://localhost/catalogue",
      SESSION_SECRET: "replace-with-a-random-string-at-least-32-characters-long"
    }),
    /SESSION_SECRET/
  );
});

test("configuration accepts only secure API origins suitable for public browser config", () => {
  const base = validTestConfig;
  assert.equal(
    readConfig({ ...base, API_BASE_URL: "https://api.chai.example" }).apiBaseUrl,
    "https://api.chai.example"
  );
  assert.equal(
    readConfig({ ...base, API_BASE_URL: "http://localhost:3001" }).apiBaseUrl,
    "http://localhost:3001"
  );
  assert.throws(
    () => readConfig({ ...base, API_BASE_URL: "https://api.chai.example/path" }),
    /HTTPS origin/
  );
  assert.throws(
    () => readConfig({ ...base, API_BASE_URL: "http://api.chai.example" }),
    /HTTPS origin/
  );
  assert.throws(
    () => readConfig({
      ...base,
      NODE_ENV: "production",
      API_BASE_URL: "http://localhost:3001"
    }),
    /HTTPS origin/
  );
});

test("public runtime config and CSP use the configured API origin", async () => {
  const app = createApp({
    pool: createFakePool(),
    apiBaseUrl: "https://api.chai.example",
    sessionSecret: testSessionSecret
  });
  const response = await request(app).get("/config.js").expect(200);
  assert.match(response.text, /https:\/\/api\.chai\.example/);
  assert.match(response.headers["content-security-policy"], /connect-src[^;]*https:\/\/api\.chai\.example/);
  await request(app).get("/library.html").expect(200);
  await request(app).get("/library.js").expect(200);
  await request(app).get("/.env").expect(404);
});

test("health endpoint checks the database connection", async () => {
  const { app } = makeTestApp();
  const response = await request(app).get("/api/health").expect(200);
  assert.deepEqual(response.body, { status: "ok", database: "connected" });
});

test("health endpoint reports a database outage as service unavailable", async () => {
  const pool = { async query() { throw new Error("database is offline"); } };
  const app = createApp({ pool, sessionSecret: testSessionSecret, logger: { error() {} } });
  const response = await request(app).get("/api/health").expect(503);
  assert.equal(response.body.error.code, "DATABASE_UNAVAILABLE");
});

test("filter and collection lists come from the database", async () => {
  const { app } = makeTestApp();
  const filters = await request(app).get("/api/filters").expect(200);
  const collections = await request(app).get("/api/collections").expect(200);
  assert.equal(filters.body.moods[0].id, "relaxed");
  assert.equal(filters.body.genres[0].id, "indie");
  assert.equal(collections.body.collections[0].id, "indie");
});

test("song listing combines search, mood, genre, and collection using SQL parameters", async () => {
  const { app, pool, loggedErrors } = makeTestApp();
  const response = await request(app)
    .get("/api/songs")
    .query({
      q: "Cold/Mess",
      mood: "rainy",
      genre: "indie",
      collection: "indie",
      limit: "6",
      offset: "0"
    });

  assert.equal(response.status, 200, JSON.stringify(loggedErrors.map(([message, error]) => [message, error.message])));
  assert.equal(response.body.pagination.total, 1);
  assert.equal(response.body.songs[0].title, "Cold/Mess");
  assert.equal(response.body.songs[0].spotifyEmbedUrl, null);
  assert.match(response.body.songs[0].spotifyUrl, /^https:\/\/open\.spotify\.com\/search\//);

  const listQuery = pool.calls.find(call => call.sql.includes("SELECT s.id, s.title"));
  assert.deepEqual(listQuery.values, ["Cold/Mess", "rainy", "indie", "indie", 6, 0]);
  assert.doesNotMatch(listQuery.sql, /Cold\/Mess/);
  assert.match(listQuery.sql, /\$1/);
  assert.match(listQuery.sql, /\$2/);
  assert.match(listQuery.sql, /\$3/);
  assert.match(listQuery.sql, /\$4/);
});

test("search input is passed as data even when it resembles SQL", async () => {
  const { app, pool, loggedErrors } = makeTestApp();
  const injectionAttempt = "' OR 1=1 --";
  const response = await request(app).get("/api/songs").query({ q: injectionAttempt });
  assert.equal(response.status, 200, JSON.stringify(loggedErrors.map(([message, error]) => [message, error.message])));
  const countQuery = pool.calls.find(call => call.sql.includes("COUNT(*)"));
  assert.equal(countQuery.values[0], injectionAttempt);
  assert.doesNotMatch(countQuery.sql, /OR 1=1/);
});

test("invalid filters, duplicate values, and excessive page sizes return 400", async () => {
  const { app } = makeTestApp();
  await request(app).get("/api/songs").query({ mood: "Relaxed" }).expect(400);
  await request(app).get("/api/songs").query({ q: ["one", "two"] }).expect(400);
  await request(app).get("/api/songs").query({ limit: "51" }).expect(400);
  await request(app).get("/api/songs").query({ offset: "-1" }).expect(400);
});

test("collection endpoint returns collection details and applies filters", async () => {
  const { app, pool, loggedErrors } = makeTestApp();
  const response = await request(app)
    .get("/api/collections/indie")
    .query({ q: "Prateek", mood: "rainy", genre: "indie" });
  assert.equal(response.status, 200, JSON.stringify(loggedErrors.map(([message, error]) => [message, error.message])));
  assert.equal(response.body.collection.id, "indie");
  assert.equal(response.body.songs[0].id, "cold-mess");

  const listQuery = pool.calls.find(call => call.sql.includes("SELECT s.id, s.title"));
  assert.deepEqual(listQuery.values, ["Prateek", "rainy", "indie", "indie", 12, 0]);
});

test("single song and missing collection use useful status codes", async () => {
  const { app } = makeTestApp();
  const response = await request(app).get("/api/songs/cold-mess").expect(200);
  assert.equal(response.body.song.title, "Cold/Mess");
  await request(app).get("/api/songs/not-here").expect(404);
  await request(app).get("/api/collections/not-here").expect(404);
  await request(app).get("/api/collections/INVALID").expect(400);
});

test("CORS only permits configured origins and private project files are not served", async () => {
  const { app } = makeTestApp();
  await request(app)
    .get("/api/health")
    .set("Origin", "https://chai.example")
    .expect("Access-Control-Allow-Origin", "https://chai.example")
    .expect(200);
  await request(app).get("/api/health").set("Origin", "https://other.example").expect(403);
  const blockedWrite = await request(app)
    .post("/api/auth/register")
    .set("Origin", "https://chai.example")
    .send({ email: "cross-site@example.test", password: "A-long-test-password-123" })
    .expect(403);
  assert.equal(blockedWrite.body.error.code, "CROSS_ORIGIN_WRITE_BLOCKED");
  await request(app).get("/seeds/catalogue.sql").expect(404);
  await request(app).get("/src/config.js").expect(404);
  await request(app).get("/.env").expect(404);
  await request(app).get("/favicon.ico").expect(204);
  const publicConfig = await request(app).get("/config.js").expect(200);
  assert.match(publicConfig.text, /apiBaseUrl/);
});

test("request bodies are size-limited and malformed JSON gets a 400", async () => {
  const { app } = makeTestApp();
  await request(app)
    .post("/api/songs")
    .send({ value: "x".repeat(11000) })
    .expect(413);
  await request(app)
    .post("/api/songs")
    .set("Content-Type", "application/json")
    .send("{invalid json")
    .expect(400);
});

test("Spotify URLs are generated only for a valid-shaped track ID", () => {
  const fallback = spotifyLinks(null, "A Song", "An Artist");
  assert.equal(fallback.spotifyEmbedUrl, null);
  assert.match(fallback.spotifyUrl, /^https:\/\/open\.spotify\.com\/search\//);

  const embed = spotifyLinks("1234567890123456789012", "A Song", "An Artist");
  assert.equal(
    embed.spotifyEmbedUrl,
    "https://open.spotify.com/embed/track/1234567890123456789012"
  );
  assert.equal(
    spotifyLinks("not-a-track-id", "A Song", "An Artist").spotifyEmbedUrl,
    null
  );
  assert.equal(
    spotifyLinks("......................", "A Song", "An Artist").spotifyEmbedUrl,
    null
  );
});
