"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { Pool } = require("pg");
const request = require("supertest");
const { createApp } = require("../src/app");

const databaseUrl = process.env.TEST_DATABASE_URL;

test("PostgreSQL migrations, seed data, search, and collection filters work together", {
  skip: !databaseUrl && "Set TEST_DATABASE_URL to run PostgreSQL integration tests."
}, async () => {
  const schema = `chai_song_test_${process.pid}`;
  const adminPool = new Pool({ connectionString: databaseUrl });
  let pool;

  try {
    await adminPool.query(`CREATE SCHEMA "${schema}"`);
    pool = new Pool({
      connectionString: databaseUrl,
      options: `-c search_path=${schema}`
    });
    const migration = await fs.readFile(
      path.join(__dirname, "..", "migrations", "001_initial_schema.sql"),
      "utf8"
    );
    const seed = await fs.readFile(
      path.join(__dirname, "..", "seeds", "catalogue.sql"),
      "utf8"
    );
    await pool.query(migration);
    await pool.query(seed);

    const app = createApp({ pool, logger: { error() {} } });
    const response = await request(app)
      .get("/api/songs")
      .query({
        q: "Anuv Jain",
        mood: "heartbreak",
        genre: "indie",
        collection: "heartbreak",
        limit: "10"
      })
      .expect(200);

    assert.equal(response.body.pagination.total, 3);
    assert.deepEqual(
      response.body.songs.map(song => song.id).sort(),
      ["alag-aasmaan", "baarishein", "husn"]
    );

    const collectionResponse = await request(app)
      .get("/api/collections/chai-chill")
      .expect(200);
    assert.equal(collectionResponse.body.collection.title, "Chai & Chill");
    assert.equal(collectionResponse.body.pagination.total, 5);
    assert.equal(collectionResponse.body.songs[0].spotifyEmbedUrl, null);

    await assert.rejects(
      pool.query(
        "INSERT INTO songs (id, title, artist, spotify_track_id) VALUES ($1, $2, $3, $4)",
        ["invalid-spotify", "Not a real link", "Test Artist", "short"]
      )
    );
  } finally {
    if (pool) await pool.end();
    await adminPool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await adminPool.end();
  }
});
