"use strict";

require("dotenv").config();

const fs = require("node:fs/promises");
const path = require("node:path");
const { readConfig } = require("../src/config");
const { createPool } = require("../src/database");

async function main() {
  const config = readConfig();
  const pool = createPool(config.databaseUrl);
  const migrationsDirectory = path.join(__dirname, "..", "migrations");

  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    const filenames = (await fs.readdir(migrationsDirectory))
      .filter(filename => /^\d+_[a-z0-9_-]+\.sql$/.test(filename))
      .sort();

    for (const filename of filenames) {
      const existing = await pool.query(
        "SELECT filename FROM schema_migrations WHERE filename = $1",
        [filename]
      );
      if (existing.rowCount > 0) {
        console.log(`Already applied: ${filename}`);
        continue;
      }

      const sql = await fs.readFile(path.join(migrationsDirectory, filename), "utf8");
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query(sql);
        await client.query("INSERT INTO schema_migrations (filename) VALUES ($1)", [filename]);
        await client.query("COMMIT");
        console.log(`Applied: ${filename}`);
      } catch (error) {
        await client.query("ROLLBACK");
        throw new Error(`Migration ${filename} failed: ${error.message}`, { cause: error });
      } finally {
        client.release();
      }
    }
  } finally {
    await pool.end();
  }
}

main().catch(error => {
  console.error("Database migration failed:", error.message);
  process.exitCode = 1;
});
