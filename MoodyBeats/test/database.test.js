"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { newDb } = require("pg-mem");
const request = require("supertest");
const { createApp } = require("../src/app");

async function runSqlFile(pool, filename) {
  const sql = await fs.readFile(path.join(__dirname, "..", filename), "utf8");
  for (const statement of sql.split(/;\s*(?:\r?\n|$)/).map(part => part.trim()).filter(Boolean)) {
    await pool.query(statement);
  }
}

test("PostgreSQL schema and repeatable seed power the API search and collections", async () => {
  const database = newDb();
  const { Pool } = database.adapters.createPg();
  const pool = new Pool();

  try {
    await runSqlFile(pool, "migrations/001_initial_schema.sql");
    await runSqlFile(pool, "seeds/catalogue.sql");
    await runSqlFile(pool, "seeds/catalogue.sql");

    const loggedErrors = [];
    const app = createApp({ pool, logger: { error: (...values) => loggedErrors.push(values) } });
    const filters = await request(app).get("/api/filters").expect(200);
    assert.equal(filters.body.moods.length, 5);
    assert.equal(filters.body.genres.length, 5);

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
    assert.equal(collection.body.collection.title, "Chai & Chill");
    assert.equal(collection.body.pagination.total, 5);

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
    assert.equal(collectionCount.rows[0].count, 6);
  } finally {
    await pool.end();
  }
});
