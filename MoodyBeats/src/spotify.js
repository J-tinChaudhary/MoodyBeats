"use strict";

const SPOTIFY_TOKEN_URL = "https://accounts.spotify.com/api/token";
const SPOTIFY_SEARCH_URL = "https://api.spotify.com/v1/search";
const SPOTIFY_TRACK_ID_PATTERN = /^[A-Za-z0-9]{22}$/;

class SpotifyError extends Error {
  constructor(message, { code = "SPOTIFY_ERROR", status = 500, retryAfter = null } = {}) {
    super(message);
    this.name = "SpotifyError";
    this.code = code;
    this.status = status;
    this.retryAfter = retryAfter;
  }
}

function createSpotifyService({
  clientId = "",
  clientSecret = "",
  fetchFn = globalThis.fetch
} = {}) {
  const cleanClientId = (clientId || "").trim();
  const cleanClientSecret = (clientSecret || "").trim();

  let cachedToken = null;
  let tokenExpiresAt = 0;

  function isConfigured() {
    return Boolean(cleanClientId && cleanClientSecret);
  }

  async function getAccessToken() {
    if (!isConfigured()) {
      throw new SpotifyError(
        "Spotify credentials are not configured. Set SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET in .env.",
        { code: "SPOTIFY_NOT_CONFIGURED", status: 503 }
      );
    }

    const now = Date.now();
    if (cachedToken && now < tokenExpiresAt) {
      return cachedToken;
    }

    const credentials = Buffer.from(`${cleanClientId}:${cleanClientSecret}`).toString("base64");

    let response;
    try {
      response = await fetchFn(SPOTIFY_TOKEN_URL, {
        method: "POST",
        headers: {
          "Authorization": `Basic ${credentials}`,
          "Content-Type": "application/x-www-form-urlencoded"
        },
        body: "grant_type=client_credentials"
      });
    } catch (error) {
      throw new SpotifyError(`Could not reach Spotify authorization service: ${error.message}`, {
        code: "SPOTIFY_NETWORK_ERROR",
        status: 502
      });
    }

    if (response.status === 429) {
      const retryAfter = Number(response.headers?.get?.("retry-after") || 5);
      throw new SpotifyError("Spotify rate limit reached. Please try again shortly.", {
        code: "SPOTIFY_RATE_LIMITED",
        status: 429,
        retryAfter
      });
    }

    if (!response.ok) {
      throw new SpotifyError(
        "Invalid Spotify credentials. Please verify SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET.",
        { code: "SPOTIFY_AUTH_FAILED", status: 401 }
      );
    }

    let body;
    try {
      body = await response.json();
    } catch {
      throw new SpotifyError("Spotify authorization returned an unreadable response.", {
        code: "SPOTIFY_RESPONSE_ERROR",
        status: 502
      });
    }

    if (!body.access_token || typeof body.access_token !== "string") {
      throw new SpotifyError("Spotify authorization did not return an access token.", {
        code: "SPOTIFY_AUTH_FAILED",
        status: 502
      });
    }

    cachedToken = body.access_token;
    const expiresIn = Number(body.expires_in) || 3600;
    // Expire 60 seconds early to avoid race conditions
    tokenExpiresAt = Date.now() + Math.max(10, expiresIn - 60) * 1000;
    return cachedToken;
  }

  function normalizeTrack(track) {
    if (!track || typeof track !== "object") return null;
    const id = track.id;
    if (!id || typeof id !== "string" || !SPOTIFY_TRACK_ID_PATTERN.test(id)) return null;

    const title = track.name || "Unknown Track";
    const artists = Array.isArray(track.artists)
      ? track.artists.map(artist => artist.name).filter(Boolean).join(", ")
      : "Unknown Artist";
    const album = track.album?.name || "";
    
    // Pick suitable image (prefer medium 300x300, or first available)
    const images = Array.isArray(track.album?.images) ? track.album.images : [];
    const artworkUrl = images[1]?.url || images[0]?.url || null;

    return {
      id: `sp-${id.toLowerCase()}`,
      spotifyTrackId: id,
      title,
      artist: artists,
      album,
      artworkUrl,
      durationMs: track.duration_ms || 0,
      spotifyUrl: track.external_urls?.spotify || `https://open.spotify.com/track/${id}`,
      spotifyEmbedUrl: `https://open.spotify.com/embed/track/${id}`,
      previewUrl: track.preview_url || null
    };
  }

  async function searchTracks(query, { limit = 12, offset = 0, market = "IN" } = {}) {
    if (typeof query !== "string" || !query.trim()) {
      throw new SpotifyError('Search query "q" is required and cannot be empty.', {
        code: "INVALID_QUERY",
        status: 400
      });
    }

    const trimmedQuery = query.trim();
    if (trimmedQuery.length > 100) {
      throw new SpotifyError('"q" must be 100 characters or fewer.', {
        code: "INVALID_QUERY",
        status: 400
      });
    }

    const parsedLimit = Math.max(1, Math.min(50, Number(limit) || 12));
    const parsedOffset = Math.max(0, Math.min(1000, Number(offset) || 0));

    const token = await getAccessToken();

    const url = new URL(SPOTIFY_SEARCH_URL);
    url.searchParams.set("q", trimmedQuery);
    url.searchParams.set("type", "track");
    url.searchParams.set("limit", String(parsedLimit));
    url.searchParams.set("offset", String(parsedOffset));
    if (market && /^[A-Z]{2}$/i.test(market)) {
      url.searchParams.set("market", market.toUpperCase());
    }

    let response;
    try {
      response = await fetchFn(url.toString(), {
        headers: {
          "Authorization": `Bearer ${token}`,
          "Accept": "application/json"
        }
      });
    } catch (error) {
      throw new SpotifyError(`Could not reach Spotify search API: ${error.message}`, {
        code: "SPOTIFY_NETWORK_ERROR",
        status: 502
      });
    }

    if (response.status === 429) {
      const retryAfter = Number(response.headers?.get?.("retry-after") || 5);
      throw new SpotifyError("Spotify rate limit reached. Please try again shortly.", {
        code: "SPOTIFY_RATE_LIMITED",
        status: 429,
        retryAfter
      });
    }

    if (response.status === 401) {
      // Invalidate cached token so next request re-authenticates
      cachedToken = null;
      tokenExpiresAt = 0;
      throw new SpotifyError("Spotify access token expired or revoked. Please try again.", {
        code: "SPOTIFY_UNAUTHORIZED",
        status: 401
      });
    }

    if (!response.ok) {
      throw new SpotifyError(`Spotify search failed with status ${response.status}.`, {
        code: "SPOTIFY_API_ERROR",
        status: response.status
      });
    }

    let data;
    try {
      data = await response.json();
    } catch {
      throw new SpotifyError("Spotify returned an invalid JSON response.", {
        code: "SPOTIFY_RESPONSE_ERROR",
        status: 502
      });
    }

    const items = data.tracks?.items || [];
    const tracks = items.map(normalizeTrack).filter(Boolean);
    const total = Number(data.tracks?.total) || 0;

    return {
      tracks,
      pagination: {
        total,
        limit: parsedLimit,
        offset: parsedOffset
      }
    };
  }

  return {
    isConfigured,
    getAccessToken,
    searchTracks
  };
}

module.exports = {
  SpotifyError,
  createSpotifyService
};

