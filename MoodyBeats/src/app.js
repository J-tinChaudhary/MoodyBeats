"use strict";

const path = require("node:path");
const express = require("express");
const helmet = require("helmet");
const repository = require("./repository");

const PROJECT_ROOT = path.resolve(__dirname, "..");

function createApp({
  pool,
  allowedOrigins = new Set(),
  apiBaseUrl = "",
  logger = console
}) {
  if (!pool || typeof pool.query !== "function") {
    throw new Error("createApp requires a PostgreSQL-compatible pool.");
  }

  const app = express();
  app.disable("x-powered-by");
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        connectSrc: ["'self'", ...(apiBaseUrl ? [apiBaseUrl] : [])],
        frameSrc: ["'self'", "https://open.spotify.com"]
      }
    }
  }));

  app.use((request, response, next) => {
    const origin = request.get("Origin");
    if (!origin) return next();
    if (!allowedOrigins.has(origin)) {
      return response.status(403).json({
        error: { code: "ORIGIN_NOT_ALLOWED", message: "This website origin is not allowed." }
      });
    }
    response.set("Access-Control-Allow-Origin", origin);
    response.set("Vary", "Origin");
    response.set("Access-Control-Allow-Methods", "GET, OPTIONS");
    response.set("Access-Control-Allow-Headers", "Content-Type");
    if (request.method === "OPTIONS") return response.sendStatus(204);
    next();
  });

  app.use(express.json({ limit: "10kb", strict: true }));

  app.get("/api/health", async (request, response) => {
    try {
      await pool.query("SELECT 1");
      response.json({ status: "ok", database: "connected" });
    } catch (error) {
      logger.error("Database health check failed:", error);
      response.status(503).json({
        error: {
          code: "DATABASE_UNAVAILABLE",
          message: "The API cannot connect to PostgreSQL. Check the database server and DATABASE_URL."
        }
      });
    }
  });

  app.get("/api/filters", async (request, response, next) => {
    try {
      response.json(await repository.listFilters(pool));
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/collections", async (request, response, next) => {
    try {
      response.json({ collections: await repository.listCollections(pool) });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/collections/:id", async (request, response, next) => {
    try {
      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(request.params.id)) {
        return response.status(400).json({
          error: { code: "INVALID_COLLECTION_ID", message: "Collection IDs must be lowercase slugs." }
        });
      }
      const collection = await repository.getCollection(pool, request.params.id);
      if (!collection) {
        return response.status(404).json({
          error: { code: "COLLECTION_NOT_FOUND", message: "That collection does not exist." }
        });
      }
      const filters = repository.parseSongFilters({ ...request.query, collection: collection.id });
      const result = await repository.listSongs(pool, filters);
      response.json({ collection, ...result });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/songs", async (request, response, next) => {
    try {
      response.json(await repository.listSongs(pool, repository.parseSongFilters(request.query)));
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/songs/:id", async (request, response, next) => {
    try {
      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(request.params.id)) {
        return response.status(400).json({
          error: { code: "INVALID_SONG_ID", message: "Song IDs must be lowercase slugs." }
        });
      }
      const song = await repository.getSong(pool, request.params.id);
      if (!song) {
        return response.status(404).json({
          error: { code: "SONG_NOT_FOUND", message: "That song does not exist." }
        });
      }
      response.json({ song });
    } catch (error) {
      next(error);
    }
  });

  app.get("/", (request, response) => response.sendFile(path.join(PROJECT_ROOT, "index.html")));
  app.get("/index.html", (request, response) => response.sendFile(path.join(PROJECT_ROOT, "index.html")));
  app.get("/playlist.html", (request, response) => response.sendFile(path.join(PROJECT_ROOT, "playlist.html")));
  app.get("/style.css", (request, response) => response.sendFile(path.join(PROJECT_ROOT, "style.css")));
  app.get("/script.js", (request, response) => response.sendFile(path.join(PROJECT_ROOT, "script.js")));
  app.get("/config.js", (request, response) => {
    response.type("application/javascript").send(
      `"use strict"; window.CHAI_AND_SONG_CONFIG = Object.freeze({ apiBaseUrl: ${JSON.stringify(apiBaseUrl)} });`
    );
  });
  app.get("/favicon.ico", (request, response) => response.sendStatus(204));

  app.use((request, response) => {
    response.status(404).json({
      error: { code: "NOT_FOUND", message: "The requested resource was not found." }
    });
  });

  app.use((error, request, response, next) => {
    if (response.headersSent) return next(error);
    if (error instanceof repository.InputError) {
      return response.status(400).json({
        error: { code: "INVALID_QUERY", message: error.message }
      });
    }
    if (error.type === "entity.too.large") {
      return response.status(413).json({
        error: { code: "REQUEST_TOO_LARGE", message: "The request body must be 10 KB or smaller." }
      });
    }
    if (error.type === "entity.parse.failed") {
      return response.status(400).json({
        error: { code: "INVALID_JSON", message: "The request body must contain valid JSON." }
      });
    }

    logger.error("Request failed:", error);
    response.status(500).json({
      error: {
        code: "INTERNAL_ERROR",
        message: "The server could not complete your request. Please try again shortly."
      }
    });
  });

  return app;
}

module.exports = { createApp };
