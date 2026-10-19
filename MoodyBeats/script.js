"use strict";

const API_BASE_URL = window.CHAI_AND_SONG_CONFIG?.apiBaseUrl || "";
const PAGE_SIZE = 12;
const collectionGrid = document.querySelector("#collection-grid");
const songGrid = document.querySelector("#song-grid");
const searchForm = document.querySelector("#search-form");
const searchInput = document.querySelector("#search-input");
const moodFilter = document.querySelector("#mood-filter");
const genreFilter = document.querySelector("#genre-filter");
const songCount = document.querySelector("#song-count");
const emptyState = document.querySelector("#empty-state");
const emptyTitle = document.querySelector("#empty-title");
const emptyMessage = document.querySelector("#empty-message");
const loadingState = document.querySelector("#loading-state");
const errorState = document.querySelector("#error-state");
const errorTitle = document.querySelector("#error-title");
const errorMessage = document.querySelector("#error-message");
const retryButton = document.querySelector("#retry-button");
const resetButton = document.querySelector("#reset-filters");
const pagination = document.querySelector("#pagination");
const previousPage = document.querySelector("#previous-page");
const nextPage = document.querySelector("#next-page");
const pageStatus = document.querySelector("#page-status");
const pageCollectionTitle = document.querySelector("#collection-title");
const pageCollectionDescription = document.querySelector("#collection-description");
const artistGrid = document.querySelector("#artist-grid");
const artistSearchForm = document.querySelector("#artist-search-form");
const artistSearchInput = document.querySelector("#artist-search-input");
const artistStatus = document.querySelector("#artist-status");
const playerFrame = document.querySelector("#player-frame");
const playerStatus = document.querySelector("#player-status");
const playerLink = document.querySelector("#player-link");
const favoriteStatus = document.querySelector("#favorite-status");

const pageCollectionId = new URLSearchParams(window.location.search).get("collection");
const isPlaylistPage = document.body.classList.contains("playlist-page");
const labels = { moods: new Map(), genres: new Map() };
let searchTerm = "";
let offset = 0;
let totalSongs = 0;
let latestRequest = 0;
let searchTimer;
let artistSearchTimer;
const favoriteIds = new Set();

function createElement(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text) element.textContent = text;
  return element;
}

function configuredApiUrl(path) {
  const configuredBase = API_BASE_URL.replace(/\/+$/, "");
  return `${configuredBase}/api${path}`;
}

async function fetchJson(path) {
  let response;
  try {
    response = await fetch(configuredApiUrl(path), {
      headers: { Accept: "application/json" }
    });
  } catch (error) {
    if (error instanceof TypeError) {
      throw new Error("Can't reach the MoodyBeats server. Check that it is running and try again.");
    }
    throw error;
  }

  let body;
  try {
    body = await response.json();
  } catch {
    throw new Error("The server returned an unreadable response. Please try again.");
  }
  if (!response.ok) {
    const error = new Error(body.error?.message || `The server returned HTTP ${response.status}.`);
    error.status = response.status;
    throw error;
  }
  return body;
}

function populateFilter(select, options, labelMap) {
  options.forEach(option => {
    const element = document.createElement("option");
    element.value = option.id;
    element.textContent = option.label;
    labelMap.set(option.id, option.label);
    select.append(element);
  });
}

function renderCollections(collections) {
  if (!collectionGrid) return;
  collectionGrid.replaceChildren();

  collections.forEach((collection, index) => {
    const card = createElement("article", `collection-card collection-${collection.color}`);
    const cover = createElement("div", "collection-cover");
    const number = createElement("span", "collection-number", String(index + 1).padStart(2, "0"));
    const symbol = createElement("span", "collection-symbol", collection.symbol);
    symbol.setAttribute("aria-hidden", "true");
    const copy = createElement("div", "collection-copy");
    const title = createElement("h3", "", collection.title);
    const description = createElement("p", "", collection.description);
    const tags = createElement("div", "collection-tags");
    (collection.tags || []).slice(0, 3).forEach(tag => tags.append(createElement("span", "collection-tag", tag)));
    const link = createElement("a", "collection-link");
    link.href = `playlist.html?collection=${encodeURIComponent(collection.id)}`;
    link.append(document.createTextNode("Explore collection "));
    const arrow = createElement("span", "", "↗");
    arrow.setAttribute("aria-hidden", "true");
    link.append(arrow);

    cover.append(number, symbol);
    copy.append(title, description, tags, link);
    card.append(cover, copy);
    collectionGrid.append(card);
  });
}

function selectSong(song) {
  playerFrame.replaceChildren();
  if (isValidEmbedUrl(song.spotifyEmbedUrl)) {
    const player = document.createElement("iframe");
    player.src = song.spotifyEmbedUrl;
    player.title = `Spotify player for ${song.title} by ${song.artist}`;
    player.width = "100%";
    player.height = "152";
    player.loading = "lazy";
    player.referrerPolicy = "strict-origin-when-cross-origin";
    player.allow = "autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture";
    player.setAttribute("allowfullscreen", "");
    playerFrame.append(player);
    playerStatus.textContent = `${song.title} by ${song.artist}. Spotify controls playback; availability varies by track, region, account, and Spotify terms.`;
    playerLink.href = song.spotifyUrl;
    playerLink.textContent = "Open on Spotify ↗";
    playerLink.hidden = !isValidSpotifyUrl(song.spotifyUrl);
    return;
  }

  playerFrame.append(
    createElement("span", "player-dial", "♫"),
    createElement("span", "", `${song.title} — ${song.artist}`)
  );
  playerStatus.textContent = "No verified Spotify track is attached to this song, so there is no embedded player. You can search Spotify for it instead.";
  if (isValidSpotifyUrl(song.spotifyUrl)) {
    playerLink.href = song.spotifyUrl;
    playerLink.textContent = "Open on Spotify ↗";
  } else {
    playerLink.href = buildSpotifySearchUrl(song);
    playerLink.textContent = "Search on Spotify ↗";
  }
  playerLink.hidden = false;
}

function isValidEmbedUrl(value) {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" &&
      url.hostname === "open.spotify.com" &&
      !url.port &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      /^\/embed\/track\/[A-Za-z0-9]{22}$/.test(url.pathname);
  } catch {
    return false;
  }
}

function isValidSpotifyUrl(value) {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" &&
      url.hostname === "open.spotify.com" &&
      !url.port &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      /^\/track\/[A-Za-z0-9]{22}$/.test(url.pathname);
  } catch {
    return false;
  }
}

function buildSpotifySearchUrl(song) {
  const url = new URL("https://open.spotify.com/search/");
  url.searchParams.set("q", `${song.title} ${song.artist}`);
  return url.toString();
}

function renderSongs(songs) {
  songGrid.replaceChildren();
  songs.forEach((song, index) => {
    const card = createElement("article", "song-card");
    const artwork = createElement("div", `song-art song-art-${index % 6}`);
    artwork.setAttribute("aria-hidden", "true");
    artwork.append(createElement("span", "art-symbol", "♫"));
    artwork.append(createElement("span", "art-sip", "a little song"));

    const info = createElement("div", "song-info");
    const title = createElement("h3", "", song.title);
    const artist = createElement("p", "song-artist", song.artist);
    const tags = createElement("div", "song-tags");
    song.moods.forEach(moodId => {
      const label = labels.moods.get(moodId);
      if (label) tags.append(createElement("span", "song-tag", label));
    });
    song.genres.forEach(genreId => {
      const label = labels.genres.get(genreId);
      if (label) tags.append(createElement("span", "song-tag song-tag-genre", label));
    });

    const actions = createElement("div", "song-actions");
    const selectButton = createElement("button", "song-play-button", "Play in the radio player");
    selectButton.type = "button";
    selectButton.addEventListener("click", () => selectSong(song));
    const favoriteButton = createElement("button", "song-favorite-button", favoriteIds.has(song.id) ? "♥ Saved" : "♡ Save");
    favoriteButton.type = "button";
    favoriteButton.setAttribute("aria-pressed", String(favoriteIds.has(song.id)));
    favoriteButton.addEventListener("click", () => toggleFavorite(song, favoriteButton));
    actions.append(selectButton, favoriteButton);
    info.append(title, artist, tags, actions);
    card.append(artwork, info);
    songGrid.append(card);
  });
}

async function toggleFavorite(song, button) {
  favoriteStatus.textContent = "";
  button.disabled = true;
  try {
    const method = favoriteIds.has(song.id) ? "DELETE" : "PUT";
    const response = await fetch(configuredApiUrl(`/me/favorites/${encodeURIComponent(song.id)}`), {
      method,
      headers: { Accept: "application/json" }
    });
    if (response.status === 401) {
      const message = createElement("span", "", "Sign in to save songs to your personal library. ");
      const link = createElement("a", "inline-link", "Go to your library");
      link.href = "library.html";
      message.append(link);
      favoriteStatus.replaceChildren(message);
      return;
    }
    if (!response.ok) {
      let body = {};
      try {
        body = await response.json();
      } catch {
        throw new Error("The server returned an unreadable response. Please try again.");
      }
      throw new Error(body.error?.message || `The server returned HTTP ${response.status}.`);
    }
    if (method === "PUT") favoriteIds.add(song.id);
    else favoriteIds.delete(song.id);
    button.textContent = favoriteIds.has(song.id) ? "♥ Saved" : "♡ Save";
    button.setAttribute("aria-pressed", String(favoriteIds.has(song.id)));
    favoriteStatus.textContent = favoriteIds.has(song.id)
      ? `${song.title} saved to your library.`
      : `${song.title} removed from your library.`;
  } catch (error) {
    favoriteStatus.textContent = error.message;
  } finally {
    button.disabled = false;
  }
}

function renderArtists(artists, total) {
  if (!artistGrid) return;
  artistGrid.replaceChildren();
  if (artists.length === 0) {
    artistStatus.textContent = "No matching performer credits in this catalogue yet.";
    return;
  }
  artistStatus.textContent = `Showing ${artists.length} of ${total} catalogue ${total === 1 ? "credit" : "credits"}.`;
  artists.forEach((artist, index) => {
    const card = createElement("article", `artist-card artist-card-${index % 4}`);
    const icon = createElement("span", "artist-mark", ["♪", "◉", "✦", "♫"][index % 4]);
    icon.setAttribute("aria-hidden", "true");
    const name = createElement("h3", "", artist.name);
    const credits = createElement("p", "", `${artist.song_count} ${artist.song_count === 1 ? "song" : "songs"} in the project catalogue`);
    const label = createElement("span", "artist-source", "Catalogue credit");
    card.append(icon, name, credits, label);
    artistGrid.append(card);
  });
}

async function loadArtists(search = "") {
  if (!artistGrid) return;
  artistStatus.textContent = "Looking through the song shelf…";
  try {
    const params = new URLSearchParams({ limit: "25", offset: "0" });
    if (search) params.set("q", search);
    const result = await fetchJson(`/artists?${params}`);
    renderArtists(result.artists, result.pagination.total);
  } catch (error) {
    artistGrid.replaceChildren();
    artistStatus.textContent = `Artist discovery is unavailable right now: ${error.message}`;
  }
}

async function loadFavoriteIds() {
  try {
    const result = await fetchJson("/me/favorites");
    result.songs.forEach(song => favoriteIds.add(song.id));
  } catch (error) {
    if (error.status !== 401) favoriteStatus.textContent = `Your saved songs could not be checked: ${error.message}`;
  }
}

function updatePagination(paginationData) {
  totalSongs = paginationData.total;
  const currentPage = Math.floor(paginationData.offset / paginationData.limit) + 1;
  const pageCount = Math.max(1, Math.ceil(totalSongs / paginationData.limit));
  pagination.hidden = totalSongs <= paginationData.limit;
  pageStatus.textContent = `Page ${currentPage} of ${pageCount}`;
  previousPage.disabled = paginationData.offset === 0;
  nextPage.disabled = paginationData.offset + paginationData.limit >= totalSongs;
}

async function loadSongs() {
  const requestNumber = ++latestRequest;
  loadingState.hidden = false;
  errorState.hidden = true;
  emptyState.hidden = true;
  pagination.hidden = true;
  songGrid.replaceChildren();

  const params = new URLSearchParams({
    limit: String(PAGE_SIZE),
    offset: String(offset)
  });
  if (searchTerm) params.set("q", searchTerm);
  if (moodFilter.value) params.set("mood", moodFilter.value);
  if (genreFilter.value) params.set("genre", genreFilter.value);
  const endpoint = isPlaylistPage
    ? `/collections/${encodeURIComponent(pageCollectionId || "")}?${params}`
    : `/songs?${params}`;

  try {
    const result = await fetchJson(endpoint);
    if (requestNumber !== latestRequest) return;
    if (isPlaylistPage) {
      document.title = `${result.collection.title} — MoodyBeats`;
      pageCollectionTitle.textContent = result.collection.title;
      pageCollectionDescription.textContent = result.collection.description;
    }
    renderSongs(result.songs);
    songCount.textContent = `${result.pagination.total} ${result.pagination.total === 1 ? "song" : "songs"}`;
    emptyState.hidden = result.songs.length > 0;
    if (result.songs.length === 0) {
      const hasFilters = Boolean(searchTerm || moodFilter.value || genreFilter.value);
      emptyTitle.textContent = isPlaylistPage && !hasFilters
        ? "This collection is waiting for its songs."
        : "No songs match this view yet.";
      emptyMessage.textContent = isPlaylistPage && !hasFilters
        ? result.collection.description
        : "Try another search, mood, or genre to find your next song.";
    }
    updatePagination(result.pagination);
  } catch (error) {
    if (requestNumber !== latestRequest) return;
    errorTitle.textContent = error.status === 404
      ? "Collection not found."
      : "We couldn't reach the song shelf.";
    errorMessage.textContent = error.message;
    retryButton.hidden = error.status === 404;
    errorState.hidden = false;
    songCount.textContent = "";
  } finally {
    if (requestNumber === latestRequest) loadingState.hidden = true;
  }
}

async function loadPageData() {
  if (isPlaylistPage && !pageCollectionId) {
    document.title = "Collection not found — MoodyBeats";
    pageCollectionTitle.textContent = "Collection not found";
    pageCollectionDescription.textContent = "Choose one of our collections to find your next song.";
    errorTitle.textContent = "Collection not found.";
    errorMessage.textContent = "Choose one of our collections to find your next song.";
    retryButton.hidden = true;
    errorState.hidden = false;
    loadingState.hidden = true;
    songCount.textContent = "0 songs";
    return;
  }

  try {
    const [filterData, collectionData] = await Promise.all([
      fetchJson("/filters"),
      collectionGrid ? fetchJson("/collections") : Promise.resolve(null),
      loadFavoriteIds(),
      loadArtists()
    ]);
    populateFilter(moodFilter, filterData.moods, labels.moods);
    populateFilter(genreFilter, filterData.genres, labels.genres);
    if (collectionGrid) renderCollections(collectionData.collections);
    if (!isPlaylistPage) {
      await loadSongs();
      return;
    }
    await loadSongs();
  } catch (error) {
    loadingState.hidden = true;
    errorTitle.textContent = "We couldn't reach the song shelf.";
    errorMessage.textContent = error.message;
    retryButton.hidden = false;
    errorState.hidden = false;
  }
}

function clearFilters() {
  searchTerm = "";
  offset = 0;
  searchInput.value = "";
  moodFilter.value = "";
  genreFilter.value = "";
  loadSongs();
}

searchInput.addEventListener("input", () => {
  window.clearTimeout(searchTimer);
  searchTerm = searchInput.value.trim();
  offset = 0;
  searchTimer = window.setTimeout(loadSongs, 250);
});

searchForm.addEventListener("submit", event => {
  event.preventDefault();
  window.clearTimeout(searchTimer);
  searchTerm = searchInput.value.trim();
  offset = 0;
  loadSongs();
  document.querySelector("#songs").scrollIntoView({ behavior: "smooth", block: "start" });
});

moodFilter.addEventListener("change", () => {
  offset = 0;
  loadSongs();
});
genreFilter.addEventListener("change", () => {
  offset = 0;
  loadSongs();
});
if (artistSearchForm) {
  artistSearchForm.addEventListener("submit", event => {
    event.preventDefault();
    window.clearTimeout(artistSearchTimer);
    loadArtists(artistSearchInput.value.trim());
  });
  artistSearchInput.addEventListener("input", () => {
    window.clearTimeout(artistSearchTimer);
    artistSearchTimer = window.setTimeout(() => loadArtists(artistSearchInput.value.trim()), 250);
  });
}
resetButton.addEventListener("click", clearFilters);
retryButton.addEventListener("click", loadSongs);
previousPage.addEventListener("click", () => {
  offset = Math.max(0, offset - PAGE_SIZE);
  loadSongs();
});
nextPage.addEventListener("click", () => {
  if (offset + PAGE_SIZE < totalSongs) {
    offset += PAGE_SIZE;
    loadSongs();
  }
});

loadPageData();
