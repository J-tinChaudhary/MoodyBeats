"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { newDb } = require("pg-mem");
const request = require("supertest");
const { createApp } = require("../src/app");
const testSessionSecret = "a-test-session-secret-with-at-least-32-characters";

async function runSqlFile(pool, filename) {
  const sql = await fs.readFile(path.join(__dirname, "..", filename), "utf8");
  for (const statement of sql.split(/;\s*(?:\r?\n|$)/).map(part => part.trim()).filter(Boolean)) {
    await pool.query(statement);
  }
}

async function makeSeededDatabase() {
  const database = newDb();
  const { Pool } = database.adapters.createPg();
  const pool = new Pool();

  await runSqlFile(pool, "migrations/001_initial_schema.sql");
  await runSqlFile(pool, "migrations/002_accounts_and_library.sql");
  await runSqlFile(pool, "seeds/catalogue.sql");
  await runSqlFile(pool, "seeds/catalogue.sql");
  return { database, pool };
}

test("PostgreSQL schema and repeatable seed power the API search and collections", async () => {
  const { pool } = await makeSeededDatabase();

  try {
    const loggedErrors = [];
    const app = createApp({
      pool,
      sessionSecret: testSessionSecret,
      logger: { error: (...values) => loggedErrors.push(values) }
    });
    const filters = await request(app).get("/api/filters").expect(200);
    assert.equal(filters.body.moods.length, 5);
    assert.equal(filters.body.genres.length, 5);
    const collectionList = await request(app).get("/api/collections").expect(200);
    assert.equal(collectionList.body.collections.length, 12);
    assert.ok(collectionList.body.collections.every(collection => collection.title && collection.tags.length));
    assert.equal(collectionList.body.collections.find(collection => collection.id === "bollywood").song_count, 0);
    assert.equal(
      collectionList.body.collections.find(collection => collection.id === "sunday-doordarshan").song_count,
      0
    );

    const response = await request(app)
      .get("/api/songs")
      .query({
        q: "Anuv Jain",
        mood: "heartbreak",
        genre: "indie",
        collection: "heartbreak",
        limit: "10"
      });
    assert.equal(
      response.status,
      200,
      JSON.stringify(loggedErrors.map(([message, error]) => [message, error.message, error.stack]))
    );
    const combined = response.body;
    assert.equal(combined.pagination.total, 3);
    assert.deepEqual(
      combined.songs.map(song => song.id).sort(),
      ["alag-aasmaan", "baarishein", "husn"]
    );
    assert.ok(combined.songs.every(song => song.spotifyEmbedUrl === null));

    const collection = await request(app)
      .get("/api/collections/chai-chill")
      .expect(200);
    assert.equal(collection.body.collection.title, "Chai Ki Tapri");
    assert.ok(collection.body.collection.tags.includes("chai break"));
    assert.equal(collection.body.pagination.total, 6);

    const artistResponse = await request(app)
      .get("/api/artists")
      .query({ q: "Anuv Jain", limit: 10 })
      .expect(200);
    assert.deepEqual(artistResponse.body.artists.map(artist => artist.name), ["Anuv Jain"]);
    assert.equal(artistResponse.body.artists[0].source, "catalogue-credits");

    const titleSearch = await request(app)
      .get("/api/songs")
      .query({ q: "Cold/Mess" })
      .expect(200);
    assert.deepEqual(titleSearch.body.songs.map(song => song.id), ["cold-mess"]);

    const singleSong = await request(app).get("/api/songs/kasoor").expect(200);
    assert.match(singleSong.body.song.spotifyUrl, /^https:\/\/open\.spotify\.com\/search\//);
    assert.equal(singleSong.body.song.spotifyEmbedUrl, null);

    const songCount = await pool.query("SELECT COUNT(*)::int AS count FROM songs");
    const collectionCount = await pool.query("SELECT COUNT(*)::int AS count FROM collections");
    assert.equal(songCount.rows[0].count, 20);
    assert.equal(collectionCount.rows[0].count, 12);
  } finally {
    await pool.end();
  }
});

test("accounts, favorites, and private playlists enforce user ownership", async () => {
  const { pool } = await makeSeededDatabase();
  try {
    const app = createApp({ pool, sessionSecret: testSessionSecret, logger: { error() {} } });
    const firstUser = request.agent(app);
    const secondUser = request.agent(app);

    await firstUser.get("/api/me/favorites").expect(401);
    const registration = await firstUser
      .post("/api/auth/register")
      .send({ email: "first@example.test", password: "A-long-test-password-123" })
      .expect(201);
    assert.equal(registration.body.user.email, "first@example.test");
    const storedUser = await pool.query("SELECT password_hash FROM users WHERE email = $1", ["first@example.test"]);
    assert.notEqual(storedUser.rows[0].password_hash, "A-long-test-password-123");
    assert.match(storedUser.rows[0].password_hash, /^\$2[aby]\$/);

    await firstUser.put("/api/me/favorites/not-a-song").expect(404);
    await firstUser.put("/api/me/favorites/Bad-Slug").expect(400);
    await firstUser.put("/api/me/favorites/kasoor").expect(204);
    await firstUser.put("/api/me/favorites/kasoor").expect(204);
    assert.deepEqual(
      (await firstUser.get("/api/me/favorites").expect(200)).body.songs.map(song => song.id),
      ["kasoor"]
    );
    await firstUser.delete("/api/me/favorites/kasoor").expect(204);
    assert.deepEqual((await firstUser.get("/api/me/favorites").expect(200)).body.songs, []);
    await firstUser.put("/api/me/favorites/kasoor").expect(204);

    const playlist = await firstUser
      .post("/api/me/playlists")
      .send({ name: "My train songs" })
      .expect(201);
    const playlistId = playlist.body.playlist.id;
    await firstUser
      .post(`/api/me/playlists/${playlistId}/songs`)
      .send({ songId: "ilahi" })
      .expect(201);
    assert.equal(
      (await firstUser.get(`/api/me/playlists/${playlistId}`).expect(200)).body.playlist.songs[0].id,
      "ilahi"
    );

    await secondUser
      .post("/api/auth/register")
      .send({ email: "second@example.test", password: "Another-long-password-456" })
      .expect(201);
    assert.deepEqual((await secondUser.get("/api/me/favorites").expect(200)).body.songs, []);
    await secondUser.get(`/api/me/playlists/${playlistId}`).expect(404);
    await secondUser.patch(`/api/me/playlists/${playlistId}`).send({ name: "Stolen" }).expect(404);
    await secondUser.delete(`/api/me/playlists/${playlistId}`).expect(404);
    await secondUser
      .post(`/api/me/playlists/${playlistId}/songs`)
      .send({ songId: "kasoor" })
      .expect(404);

    await firstUser
      .patch(`/api/me/playlists/${playlistId}`)
      .send({ name: "Renamed journey" })
      .expect(200);
    await firstUser.delete(`/api/me/playlists/${playlistId}/songs/ilahi`).expect(204);
    await firstUser.delete(`/api/me/playlists/${playlistId}`).expect(204);
    await firstUser.post("/api/auth/logout").expect(204);
    await firstUser.get("/api/me/favorites").expect(401);
    await secondUser.post("/api/auth/logout").expect(204);

    await firstUser
      .post("/api/auth/login")
      .send({ email: "first@example.test", password: "wrong-password" })
      .expect(401);
    await firstUser
      .post("/api/auth/login")
      .send({ email: "first@example.test", password: "A-long-test-password-123" })
      .expect(200);
    await firstUser.post("/api/auth/logout").expect(204);
    await request(app)
      .post("/api/auth/register")
      .send({ email: "bad-email", password: "short" })
      .expect(400);
  } finally {
    await pool.end();
  }
});
