"use strict";

require("dotenv").config();

const fs = require("node:fs/promises");
const path = require("node:path");
const { readConfig } = require("../src/config");
const { createPool } = require("../src/database");

async function main() {
  const config = readConfig();
  const pool = createPool(config.databaseUrl);
  const seedFile = path.join(__dirname, "..", "seeds", "catalogue.sql");

  try {
    const sql = await fs.readFile(seedFile, "utf8");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query("COMMIT");
      console.log("Catalogue data inserted or updated successfully.");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }
}

main().catch(error => {
  console.error("Database seeding failed:", error.message);
  process.exitCode = 1;
});
