"use strict";

const path = require("node:path");
const { randomUUID } = require("node:crypto");
const express = require("express");
const helmet = require("helmet");
const session = require("express-session");
const { rateLimit } = require("express-rate-limit");
const bcrypt = require("bcryptjs");
const repository = require("./repository");
const { createSpotifyService, SpotifyError } = require("./spotify");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const DUMMY_PASSWORD_HASH = "$2b$12$CM9bhYh.pkdSeZjZ6qgCBeVIdDbaQb2vIVfB/Q2nwvEUcFVeMWEiS";

function createApp({
  pool,
  allowedOrigins = new Set(),
  apiBaseUrl = "",
  sessionSecret,
  sessionStore,
  secureCookies = false,
  logger = console,
  spotifyService,
  spotifyClientId = "",
  spotifyClientSecret = ""
}) {
  if (!pool || typeof pool.query !== "function") {
    throw new Error("createApp requires a PostgreSQL-compatible pool.");
  }
  if (typeof sessionSecret !== "string" || sessionSecret.length < 32) {
    throw new Error("createApp requires a session secret of at least 32 characters.");
  }

  const spotify = spotifyService || createSpotifyService({
    clientId: spotifyClientId,
    clientSecret: spotifyClientSecret
  });

  const app = express();
  app.disable("x-powered-by");
  if (secureCookies) app.set("trust proxy", 1);
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        connectSrc: ["'self'", ...(apiBaseUrl ? [apiBaseUrl] : [])],
        frameSrc: ["'self'", "https://open.spotify.com"],
        imgSrc: ["'self'", "data:", "https://*.scdn.co", "https://i.scdn.co"]
      }
    }
  }));

  app.use((request, response, next) => {
    const origin = request.get("Origin");
    if (!origin) return next();
    const requestOrigin = `${request.protocol}://${request.get("host")}`;
    if (origin !== requestOrigin && !allowedOrigins.has(origin)) {
      return response.status(403).json({
        error: { code: "ORIGIN_NOT_ALLOWED", message: "This website origin is not allowed." }
      });
    }
    if (!["GET", "HEAD", "OPTIONS"].includes(request.method) && origin !== requestOrigin) {
      return response.status(403).json({
        error: { code: "CROSS_ORIGIN_WRITE_BLOCKED", message: "Account changes must come from the same website." }
      });
    }
    response.set("Access-Control-Allow-Origin", origin);
    response.set("Vary", "Origin");
    response.set("Access-Control-Allow-Credentials", "true");
    response.set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
    response.set("Access-Control-Allow-Headers", "Content-Type");
    if (request.method === "OPTIONS") return response.sendStatus(204);
    next();
  });

  app.use(express.json({ limit: "10kb", strict: true }));
  app.use(session({
    name: "moodybeats.sid",
    secret: sessionSecret,
    store: sessionStore,
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: secureCookies,
      maxAge: 7 * 24 * 60 * 60 * 1000
    }
  }));

  const authRateLimit = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { error: { code: "AUTH_RATE_LIMIT", message: "Too many sign-in attempts. Try again in 15 minutes." } }
  });

  function requireBody(request) {
    if (!request.body || typeof request.body !== "object" || Array.isArray(request.body)) {
      throw new repository.InputError("The request body must be a JSON object.");
    }
    return request.body;
  }

  function requireSlug(value, label) {
    if (typeof value !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)) {
      throw new repository.InputError(`${label} must be a lowercase slug.`);
    }
    return value;
  }

  function requireUuid(value, label) {
    if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
      throw new repository.InputError(`${label} must be a valid ID.`);
    }
    return value;
  }

  function regenerateSession(request) {
    return new Promise((resolve, reject) => {
      request.session.regenerate(error => error ? reject(error) : resolve());
    });
  }

  function destroySession(request) {
    return new Promise((resolve, reject) => {
      request.session.destroy(error => error ? reject(error) : resolve());
    });
  }

  async function currentUser(request, response) {
    if (!request.session.userId) {
      response.status(401).json({ error: { code: "AUTHENTICATION_REQUIRED", message: "Sign in to use your library." } });
      return null;
    }
    const result = await pool.query("SELECT id, email FROM users WHERE id = $1", [request.session.userId]);
    if (!result.rows[0]) {
      await destroySession(request);
      response.status(401).json({ error: { code: "AUTHENTICATION_REQUIRED", message: "Sign in to use your library." } });
      return null;
    }
    return result.rows[0];
  }

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

  app.get("/api/artists", async (request, response, next) => {
    try {
      response.json(await repository.listArtists(pool, repository.parseArtistFilters(request.query)));
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

  app.get("/api/spotify/status", (request, response) => {
    response.json({ configured: spotify.isConfigured() });
  });

  app.get("/api/spotify/search", async (request, response, next) => {
    try {
      const q = request.query.q;
      if (typeof q !== "string" || !q.trim()) {
        return response.status(400).json({
          error: { code: "INVALID_QUERY", message: 'Search query "q" is required and cannot be empty.' }
        });
      }
      const limit = request.query.limit;
      const offset = request.query.offset;
      const market = request.query.market || "IN";
      const result = await spotify.searchTracks(q, { limit, offset, market });
      response.json(result);
    } catch (error) {
      if (error instanceof SpotifyError) {
        return response.status(error.status).json({
          error: {
            code: error.code,
            message: error.message,
            ...(error.retryAfter ? { retryAfter: error.retryAfter } : {})
          }
        });
      }
      next(error);
    }
  });

  app.post("/api/spotify/save", async (request, response, next) => {
    try {
      const user = await currentUser(request, response);
      if (!user) return;

      const body = requireBody(request);
      const spotifyTrackId = body.spotifyTrackId;
      const title = body.title;
      const artist = body.artist;

      if (typeof spotifyTrackId !== "string" || !/^[A-Za-z0-9]{22}$/.test(spotifyTrackId)) {
        return response.status(400).json({
          error: { code: "INVALID_TRACK_ID", message: "A valid 22-character Spotify track ID is required." }
        });
      }
      if (typeof title !== "string" || !title.trim() || title.trim().length > 200) {
        return response.status(400).json({
          error: { code: "INVALID_TITLE", message: "Track title is required and must be 200 characters or fewer." }
        });
      }
      if (typeof artist !== "string" || !artist.trim() || artist.trim().length > 200) {
        return response.status(400).json({
          error: { code: "INVALID_ARTIST", message: "Artist name is required and must be 200 characters or fewer." }
        });
      }

      const songId = `sp-${spotifyTrackId.toLowerCase()}`;
      await repository.ensureSpotifySong(pool, {
        id: songId,
        title: title.trim(),
        artist: artist.trim(),
        spotifyTrackId
      });

      const added = await repository.addFavorite(pool, user.id, songId);
      response.status(added ? 201 : 200).json({
        status: added ? "added" : "already-favorite",
        songId,
        title: title.trim(),
        artist: artist.trim()
      });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/auth/register", authRateLimit, async (request, response, next) => {
    try {
      const body = requireBody(request);
      const email = repository.parseEmail(body.email);
      const password = repository.parsePassword(body.password);
      const passwordHash = await bcrypt.hash(password, 12);
      let user;
      try {
        user = await repository.createUser(pool, randomUUID(), email, passwordHash);
      } catch (error) {
        if (error.code === "23505") {
          return response.status(409).json({
            error: { code: "ACCOUNT_EXISTS", message: "An account with that email already exists." }
          });
        }
        throw error;
      }
      await regenerateSession(request);
      request.session.userId = user.id;
      response.status(201).json({ user });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/auth/login", authRateLimit, async (request, response, next) => {
    try {
      const body = requireBody(request);
      const email = repository.parseEmail(body.email);
      if (typeof body.password !== "string" || Buffer.byteLength(body.password, "utf8") > 72) {
        return response.status(401).json({
          error: { code: "INVALID_CREDENTIALS", message: "Email or password is incorrect." }
        });
      }
      const user = await repository.getUserByEmail(pool, email);
      const passwordMatches = user
        ? await bcrypt.compare(body.password, user.password_hash)
        : await bcrypt.compare(body.password, DUMMY_PASSWORD_HASH);
      if (!user || !passwordMatches) {
        return response.status(401).json({
          error: { code: "INVALID_CREDENTIALS", message: "Email or password is incorrect." }
        });
      }
      await regenerateSession(request);
      request.session.userId = user.id;
      response.json({ user: { id: user.id, email: user.email } });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/auth/logout", async (request, response, next) => {
    try {
      if (!request.session.userId) {
        return response.status(401).json({
          error: { code: "AUTHENTICATION_REQUIRED", message: "You are not signed in." }
        });
      }
      await destroySession(request);
      response.clearCookie("moodybeats.sid", {
        httpOnly: true,
        sameSite: "lax",
        secure: secureCookies
      });
      response.sendStatus(204);
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/me", async (request, response, next) => {
    try {
      const user = await currentUser(request, response);
      if (user) response.json({ user });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/me/favorites", async (request, response, next) => {
    try {
      const user = await currentUser(request, response);
      if (user) response.json({ songs: await repository.listFavorites(pool, user.id) });
    } catch (error) {
      next(error);
    }
  });

  app.put("/api/me/favorites/:songId", async (request, response, next) => {
    try {
      const user = await currentUser(request, response);
      if (!user) return;
      const songId = requireSlug(request.params.songId, "Song ID");
      const added = await repository.addFavorite(pool, user.id, songId);
      if (added === null) {
        return response.status(404).json({ error: { code: "SONG_NOT_FOUND", message: "That song does not exist." } });
      }
      response.sendStatus(204);
    } catch (error) {
      next(error);
    }
  });

  app.delete("/api/me/favorites/:songId", async (request, response, next) => {
    try {
      const user = await currentUser(request, response);
      if (!user) return;
      await repository.removeFavorite(pool, user.id, requireSlug(request.params.songId, "Song ID"));
      response.sendStatus(204);
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/me/playlists", async (request, response, next) => {
    try {
      const user = await currentUser(request, response);
      if (user) response.json({ playlists: await repository.listPlaylists(pool, user.id) });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/me/playlists", async (request, response, next) => {
    try {
      const user = await currentUser(request, response);
      if (!user) return;
      const body = requireBody(request);
      const playlist = await repository.createPlaylist(
        pool,
        randomUUID(),
        user.id,
        repository.parsePlaylistName(body.name)
      );
      response.status(201).json({ playlist });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/me/playlists/:id", async (request, response, next) => {
    try {
      const user = await currentUser(request, response);
      if (!user) return;
      const id = requireUuid(request.params.id, "Playlist ID");
      const playlist = await repository.getPlaylist(pool, user.id, id);
      if (!playlist) {
        return response.status(404).json({ error: { code: "PLAYLIST_NOT_FOUND", message: "That playlist does not exist." } });
      }
      response.json({ playlist });
    } catch (error) {
      next(error);
    }
  });

  app.patch("/api/me/playlists/:id", async (request, response, next) => {
    try {
      const user = await currentUser(request, response);
      if (!user) return;
      const body = requireBody(request);
      const playlist = await repository.renamePlaylist(
        pool,
        user.id,
        requireUuid(request.params.id, "Playlist ID"),
        repository.parsePlaylistName(body.name)
      );
      if (!playlist) {
        return response.status(404).json({ error: { code: "PLAYLIST_NOT_FOUND", message: "That playlist does not exist." } });
      }
      response.json({ playlist });
    } catch (error) {
      next(error);
    }
  });

  app.delete("/api/me/playlists/:id", async (request, response, next) => {
    try {
      const user = await currentUser(request, response);
      if (!user) return;
      const deleted = await repository.deletePlaylist(pool, user.id, requireUuid(request.params.id, "Playlist ID"));
      if (!deleted) {
        return response.status(404).json({ error: { code: "PLAYLIST_NOT_FOUND", message: "That playlist does not exist." } });
      }
      response.sendStatus(204);
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/me/playlists/:id/songs", async (request, response, next) => {
    try {
      const user = await currentUser(request, response);
      if (!user) return;
      const body = requireBody(request);
      const result = await repository.addPlaylistSong(
        pool,
        user.id,
        requireUuid(request.params.id, "Playlist ID"),
        requireSlug(body.songId, "Song ID")
      );
      if (result === "missing-playlist") {
        return response.status(404).json({ error: { code: "PLAYLIST_NOT_FOUND", message: "That playlist does not exist." } });
      }
      if (result === "missing-song") {
        return response.status(404).json({ error: { code: "SONG_NOT_FOUND", message: "That song does not exist." } });
      }
      response.status(result === "added" ? 201 : 200).json({ added: result === "added" });
    } catch (error) {
      next(error);
    }
  });

  app.delete("/api/me/playlists/:id/songs/:songId", async (request, response, next) => {
    try {
      const user = await currentUser(request, response);
      if (!user) return;
      const removed = await repository.removePlaylistSong(
        pool,
        user.id,
        requireUuid(request.params.id, "Playlist ID"),
        requireSlug(request.params.songId, "Song ID")
      );
      if (!removed) {
        return response.status(404).json({ error: { code: "PLAYLIST_SONG_NOT_FOUND", message: "That song is not in this playlist." } });
      }
      response.sendStatus(204);
    } catch (error) {
      next(error);
    }
  });

  app.get("/", (request, response) => response.sendFile(path.join(PROJECT_ROOT, "index.html")));
  app.get("/index.html", (request, response) => response.sendFile(path.join(PROJECT_ROOT, "index.html")));
  app.get("/playlist.html", (request, response) => response.sendFile(path.join(PROJECT_ROOT, "playlist.html")));
  app.get("/library.html", (request, response) => response.sendFile(path.join(PROJECT_ROOT, "library.html")));
  app.get("/style.css", (request, response) => response.sendFile(path.join(PROJECT_ROOT, "style.css")));
  app.get("/script.js", (request, response) => response.sendFile(path.join(PROJECT_ROOT, "script.js")));
  app.get("/library.js", (request, response) => response.sendFile(path.join(PROJECT_ROOT, "library.js")));
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
