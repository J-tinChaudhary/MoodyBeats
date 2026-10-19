"use strict";

function readConfig(environment = process.env) {
  const port = Number(environment.PORT || 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("PORT must be an integer between 1 and 65535.");
  }

  const databaseUrl = environment.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required. Copy .env.example to .env and configure PostgreSQL.");
  }

  const sessionSecret = environment.SESSION_SECRET;
  if (
    typeof sessionSecret !== "string" ||
    sessionSecret.length < 32 ||
    sessionSecret.startsWith("replace-with-")
  ) {
    throw new Error("SESSION_SECRET is required and must contain at least 32 characters.");
  }

  let parsedDatabaseUrl;
  try {
    parsedDatabaseUrl = new URL(databaseUrl);
  } catch {
    throw new Error("DATABASE_URL must be a valid PostgreSQL connection URL.");
  }
  if (!["postgres:", "postgresql:"].includes(parsedDatabaseUrl.protocol)) {
    throw new Error("DATABASE_URL must use the postgres:// or postgresql:// protocol.");
  }

  const allowedOrigins = (environment.ALLOWED_ORIGINS || "")
    .split(",")
    .map(origin => origin.trim())
    .filter(Boolean)
    .map(origin => {
      let parsedOrigin;
      try {
        parsedOrigin = new URL(origin);
      } catch {
        throw new Error(`ALLOWED_ORIGINS contains an invalid origin: ${origin}`);
      }
      if (!["http:", "https:"].includes(parsedOrigin.protocol) || parsedOrigin.origin !== origin) {
        throw new Error(`ALLOWED_ORIGINS entries must be exact HTTP or HTTPS origins: ${origin}`);
      }
      return origin;
    });

  let apiBaseUrl = "";
  if (environment.API_BASE_URL) {
    let parsedApiBaseUrl;
    try {
      parsedApiBaseUrl = new URL(environment.API_BASE_URL);
    } catch {
      throw new Error("API_BASE_URL must be a public HTTP or HTTPS origin.");
    }
    const isLocalHttp =
      parsedApiBaseUrl.protocol === "http:" &&
      ["localhost", "127.0.0.1"].includes(parsedApiBaseUrl.hostname);
    if (
      (!["http:", "https:"].includes(parsedApiBaseUrl.protocol)) ||
      parsedApiBaseUrl.origin !== environment.API_BASE_URL ||
      (environment.NODE_ENV === "production" && !parsedApiBaseUrl.protocol.startsWith("https:")) ||
      (parsedApiBaseUrl.protocol === "http:" && !isLocalHttp)
    ) {
      throw new Error("API_BASE_URL must be an HTTPS origin (HTTP is allowed only for localhost during development).");
    }
    apiBaseUrl = parsedApiBaseUrl.origin;
  }

  const spotifyClientId = (environment.SPOTIFY_CLIENT_ID || "").trim();
  const spotifyClientSecret = (environment.SPOTIFY_CLIENT_SECRET || "").trim();
  if ((spotifyClientId && !spotifyClientSecret) || (!spotifyClientId && spotifyClientSecret)) {
    throw new Error("Both SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET must be provided to enable Spotify integration.");
  }

  return {
    port,
    databaseUrl,
    sessionSecret,
    allowedOrigins: new Set(allowedOrigins),
    apiBaseUrl,
    nodeEnv: environment.NODE_ENV || "development",
    spotifyClientId,
    spotifyClientSecret
  };
}

module.exports = { readConfig };
