"use strict";

const { Pool } = require("pg");

function createPool(connectionString) {
  return new Pool({
    connectionString,
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
    ssl: process.env.PGSSLMODE === "require" ? { rejectUnauthorized: true } : undefined
  });
}

module.exports = { createPool };
