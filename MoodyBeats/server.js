"use strict";

require("dotenv").config();

const { readConfig } = require("./src/config");
const { createPool } = require("./src/database");
const { createApp } = require("./src/app");
const connectPgSimple = require("connect-pg-simple");
const session = require("express-session");

let config;
try {
  config = readConfig();
} catch (error) {
  console.error(`Configuration error: ${error.message}`);
  process.exit(1);
}

const pool = createPool(config.databaseUrl);
const PgSessionStore = connectPgSimple(session);
pool.on("error", error => {
  console.error("Unexpected error from an idle PostgreSQL connection:", error);
});
const app = createApp({
  pool,
  allowedOrigins: config.allowedOrigins,
  apiBaseUrl: config.apiBaseUrl,
  sessionSecret: config.sessionSecret,
  sessionStore: new PgSessionStore({
    pool,
    tableName: "user_sessions",
    createTableIfMissing: false
  }),
  secureCookies: config.nodeEnv === "production"
});
const server = app.listen(config.port, () => {
  console.log(`MoodyBeats is running at http://localhost:${config.port}`);
});

let isShuttingDown = false;
async function shutdown(signal) {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.log(`Received ${signal}; closing the server.`);
  server.close(async error => {
    if (error) {
      console.error("Could not close the HTTP server cleanly:", error);
      process.exitCode = 1;
    }
    try {
      await pool.end();
    } catch (poolError) {
      console.error("Could not close the database pool cleanly:", poolError);
      process.exitCode = 1;
    }
  });
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
