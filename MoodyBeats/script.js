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

const pageCollectionId = new URLSearchParams(window.location.search).get("collection");
const isPlaylistPage = document.body.classList.contains("playlist-page");
const labels = { moods: new Map(), genres: new Map() };
let searchTerm = "";
let offset = 0;
let totalSongs = 0;
let latestRequest = 0;
let searchTimer;

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
      throw new Error("Can't reach the Chai & Song server. Check that it is running and try again.");
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
    const link = createElement("a", "collection-link");
    link.href = `playlist.html?collection=${encodeURIComponent(collection.id)}`;
    link.append(document.createTextNode("Explore collection "));
    const arrow = createElement("span", "", "↗");
    arrow.setAttribute("aria-hidden", "true");
    link.append(arrow);

    cover.append(number, symbol);
    copy.append(title, description, link);
    card.append(cover, copy);
    collectionGrid.append(card);
  });
}

function makeSpotifyPlayer(song) {
  const section = createElement("div", "spotify-player");
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
    section.append(player);
  }

  const link = createElement("a", "spotify-link");
  link.href = isValidSpotifyUrl(song.spotifyUrl) ? song.spotifyUrl : buildSpotifySearchUrl(song);
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.textContent = song.spotifyEmbedUrl ? "Open on Spotify ↗" : "Find on Spotify ↗";
  section.append(link);
  return section;
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

    info.append(title, artist, tags, makeSpotifyPlayer(song));
    card.append(artwork, info);
    songGrid.append(card);
  });
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
      document.title = `${result.collection.title} — Chai & Song`;
      pageCollectionTitle.textContent = result.collection.title;
      pageCollectionDescription.textContent = result.collection.description;
    }
    renderSongs(result.songs);
    songCount.textContent = `${result.pagination.total} ${result.pagination.total === 1 ? "song" : "songs"}`;
    emptyState.hidden = result.songs.length > 0;
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
    document.title = "Collection not found — Chai & Song";
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
      collectionGrid ? fetchJson("/collections") : Promise.resolve(null)
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
