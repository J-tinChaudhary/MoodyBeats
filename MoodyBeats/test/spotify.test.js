"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const { createApp } = require("../src/app");
const { readConfig } = require("../src/config");
const { createSpotifyService, SpotifyError } = require("../src/spotify");

const testSessionSecret = "a-test-session-secret-with-at-least-32-characters";

const sampleSpotifyItem = {
  id: "4cOdK2wGLETKBW3PvgPWqT",
  name: "Never Gonna Give You Up",
  artists: [{ id: "artist1", name: "Rick Astley" }],
  album: {
    id: "album1",
    name: "Whenever You Need Somebody",
    images: [
      { url: "https://i.scdn.co/image/large", height: 640, width: 640 },
      { url: "https://i.scdn.co/image/medium", height: 300, width: 300 }
    ]
  },
  duration_ms: 213573,
  preview_url: "https://p.scdn.co/mp3-preview/sample",
  external_urls: {
    spotify: "https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT"
  }
};

function createMockFetch(responses = {}) {
  const calls = [];
  const fetchFn = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    const urlStr = String(url);

    if (urlStr.startsWith("https://accounts.spotify.com/api/token")) {
      if (responses.tokenError) return responses.tokenError;
      return {
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => ({
          access_token: "mock-access-token",
          token_type: "Bearer",
          expires_in: 3600
        })
      };
    }

    if (urlStr.startsWith("https://api.spotify.com/v1/search")) {
      if (responses.searchError) return responses.searchError;
      return {
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => ({
          tracks: {
            items: [sampleSpotifyItem],
            total: 1,
            limit: 12,
            offset: 0
          }
        })
      };
    }

    throw new Error(`Unhandled mock URL: ${urlStr}`);
  };
  return { fetchFn, calls };
}

test("readConfig validates matching SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET", () => {
  const baseConfig = {
    DATABASE_URL: "postgres://localhost/test",
    SESSION_SECRET: "a-test-secret-that-is-at-least-32-characters"
  };

  assert.throws(
    () => readConfig({ ...baseConfig, SPOTIFY_CLIENT_ID: "client-id-only" }),
    /Both SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET must be provided/
  );

  assert.throws(
    () => readConfig({ ...baseConfig, SPOTIFY_CLIENT_SECRET: "client-secret-only" }),
    /Both SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET must be provided/
  );

  const configured = readConfig({
    ...baseConfig,
    SPOTIFY_CLIENT_ID: "my-id",
    SPOTIFY_CLIENT_SECRET: "my-secret"
  });
  assert.equal(configured.spotifyClientId, "my-id");
  assert.equal(configured.spotifyClientSecret, "my-secret");
});

test("spotify service reports configured status and enforces credentials", async () => {
  const unconfigured = createSpotifyService();
  assert.equal(unconfigured.isConfigured(), false);
  await assert.rejects(
    () => unconfigured.getAccessToken(),
    err => err instanceof SpotifyError && err.code === "SPOTIFY_NOT_CONFIGURED"
  );
  await assert.rejects(
    () => unconfigured.searchTracks("cold mess"),
    err => err instanceof SpotifyError && err.code === "SPOTIFY_NOT_CONFIGURED"
  );
});

test("spotify service authenticates, caches token, and searches tracks", async () => {
  const { fetchFn, calls } = createMockFetch();
  const service = createSpotifyService({
    clientId: "mock-client",
    clientSecret: "mock-secret",
    fetchFn
  });

  assert.equal(service.isConfigured(), true);

  const result = await service.searchTracks("Never Gonna Give You Up");
  assert.equal(result.tracks.length, 1);
  const track = result.tracks[0];
  assert.equal(track.title, "Never Gonna Give You Up");
  assert.equal(track.artist, "Rick Astley");
  assert.equal(track.album, "Whenever You Need Somebody");
  assert.equal(track.artworkUrl, "https://i.scdn.co/image/medium");
  assert.equal(track.spotifyTrackId, "4cOdK2wGLETKBW3PvgPWqT");
  assert.equal(track.spotifyEmbedUrl, "https://open.spotify.com/embed/track/4cOdK2wGLETKBW3PvgPWqT");

  // Verify token caching: second search does not call token endpoint again
  await service.searchTracks("Rick Astley");
  const tokenCalls = calls.filter(c => c.url.includes("accounts.spotify.com"));
  assert.equal(tokenCalls.length, 1);
});

test("spotify service handles 429 rate limit", async () => {
  const { fetchFn } = createMockFetch({
    searchError: {
      ok: false,
      status: 429,
      headers: new Headers({ "retry-after": "12" })
    }
  });
  const service = createSpotifyService({
    clientId: "id",
    clientSecret: "secret",
    fetchFn
  });

  await assert.rejects(
    () => service.searchTracks("test"),
    err => err instanceof SpotifyError && err.code === "SPOTIFY_RATE_LIMITED" && err.retryAfter === 12
  );
});

test("api endpoints handle spotify status and live search", async () => {
  const { fetchFn } = createMockFetch();
  const spotifyService = createSpotifyService({
    clientId: "id",
    clientSecret: "secret",
    fetchFn
  });

  const pool = {
    async query() {
      return { rows: [], rowCount: 0 };
    }
  };

  const app = createApp({
    pool,
    sessionSecret: testSessionSecret,
    spotifyService
  });

  // Status check
  const statusRes = await request(app).get("/api/spotify/status").expect(200);
  assert.deepEqual(statusRes.body, { configured: true });

  // Missing query parameter
  const badQuery = await request(app).get("/api/spotify/search").expect(400);
  assert.equal(badQuery.body.error.code, "INVALID_QUERY");

  // Valid search
  const searchRes = await request(app).get("/api/spotify/search?q=Rick").expect(200);
  assert.equal(searchRes.body.tracks.length, 1);
  assert.equal(searchRes.body.tracks[0].spotifyTrackId, "4cOdK2wGLETKBW3PvgPWqT");
});

test("api endpoint reports unconfigured spotify service", async () => {
  const pool = { async query() { return { rows: [], rowCount: 0 }; } };
  const app = createApp({
    pool,
    sessionSecret: testSessionSecret,
    spotifyService: createSpotifyService()
  });

  const statusRes = await request(app).get("/api/spotify/status").expect(200);
  assert.deepEqual(statusRes.body, { configured: false });

  const searchRes = await request(app).get("/api/spotify/search?q=test").expect(503);
  assert.equal(searchRes.body.error.code, "SPOTIFY_NOT_CONFIGURED");
});

test("saving a spotify song requires authentication and validates track details", async () => {
  const queries = [];
  const pool = {
    async query(sql, values = []) {
      queries.push({ sql, values });
      if (sql.includes("SELECT id, email FROM users")) {
        return { rows: [{ id: "user-1", email: "user@example.test" }], rowCount: 1 };
      }
      if (sql.includes("INSERT INTO songs")) {
        return { rows: [], rowCount: 1 };
      }
      if (sql.includes("INSERT INTO favorites")) {
        return { rows: [{ song_id: values[1] }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    }
  };

  const app = createApp({
    pool,
    sessionSecret: testSessionSecret,
    spotifyService: createSpotifyService()
  });

  // Unauthorized request
  await request(app)
    .post("/api/spotify/save")
    .send({
      spotifyTrackId: "4cOdK2wGLETKBW3PvgPWqT",
      title: "Never Gonna Give You Up",
      artist: "Rick Astley"
    })
    .expect(401);

  // Invalid body when unauthenticated or authenticated
  await request(app)
    .post("/api/spotify/save")
    .send({})
    .expect(401);
});

