"use strict";

const loading = document.querySelector("#library-loading");
const errorPanel = document.querySelector("#library-error");
const errorMessage = document.querySelector("#library-error-message");
const authPanel = document.querySelector("#auth-panel");
const libraryPanel = document.querySelector("#personal-library");
const authForm = document.querySelector("#auth-form");
const authStatus = document.querySelector("#auth-status");
const accountStatus = document.querySelector("#account-status");
const playlistStatus = document.querySelector("#playlist-status");
const favoriteList = document.querySelector("#favorite-list");
const playlistList = document.querySelector("#playlist-list");
const favoriteEmpty = document.querySelector("#favorites-empty");
const playlistsEmpty = document.querySelector("#playlists-empty");
const createPlaylistForm = document.querySelector("#create-playlist-form");
let authMode = "login";
let catalogueSongs = [];

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

async function api(path, options = {}) {
  let response;
  try {
    response = await fetch(path, {
      ...options,
      headers: {
        Accept: "application/json",
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...options.headers
      }
    });
  } catch {
    throw new Error("Can't reach the MoodyBeats server. Check your connection and try again.");
  }

  if (response.status === 204) return null;
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

function showError(error) {
  loading.hidden = true;
  authPanel.hidden = true;
  libraryPanel.hidden = true;
  errorMessage.textContent = error.message;
  errorPanel.hidden = false;
}

function setAuthMode(mode) {
  authMode = mode;
  const isLogin = mode === "login";
  document.querySelector("#show-login").classList.toggle("is-active", isLogin);
  document.querySelector("#show-login").setAttribute("aria-pressed", String(isLogin));
  document.querySelector("#show-register").classList.toggle("is-active", !isLogin);
  document.querySelector("#show-register").setAttribute("aria-pressed", String(!isLogin));
  document.querySelector("#auth-title").textContent = isLogin ? "Keep your favourites close." : "Make room for your own mixtapes.";
  document.querySelector("#auth-submit").textContent = isLogin ? "Sign in" : "Create account";
  document.querySelector("#auth-password").autocomplete = isLogin ? "current-password" : "new-password";
  document.querySelector("#password-hint").textContent = isLogin
    ? "Use the password you chose for MoodyBeats."
    : "Use at least 12 characters. Your password is stored as a salted hash.";
  authStatus.textContent = "";
}

function renderSongRow(song, { onRemove, onPlay } = {}) {
  const row = element("article", "library-song");
  const details = element("div", "library-song-copy");
  details.append(element("h4", "", song.title), element("p", "", song.artist));
  row.append(details);
  if (onPlay) {
    const play = element("a", "library-song-link", "Find song");
    play.href = `index.html#songs`;
    row.append(play);
  }
  if (onRemove) {
    const remove = element("button", "text-button library-remove", "Remove");
    remove.type = "button";
    remove.addEventListener("click", onRemove);
    row.append(remove);
  }
  return row;
}

function renderFavorites(songs) {
  favoriteList.replaceChildren();
  favoriteEmpty.hidden = songs.length > 0;
  songs.forEach(song => {
    favoriteList.append(renderSongRow(song, {
      onRemove: async () => {
        accountStatus.textContent = "";
        try {
          await api(`/api/me/favorites/${encodeURIComponent(song.id)}`, { method: "DELETE" });
          await loadFavorites();
          accountStatus.textContent = `${song.title} removed from favourites.`;
        } catch (error) {
          accountStatus.textContent = error.message;
        }
      }
    }));
  });
}

async function loadFavorites() {
  const result = await api("/api/me/favorites");
  renderFavorites(result.songs);
}

async function loadPlaylistDetails(playlist) {
  return (await api(`/api/me/playlists/${encodeURIComponent(playlist.id)}`)).playlist;
}

function renderPlaylist(playlist) {
  const card = element("article", "personal-playlist");
  const heading = element("div", "personal-playlist-heading");
  const title = element("h4", "", playlist.name);
  const count = element("span", "playlist-count", `${playlist.songs.length} ${playlist.songs.length === 1 ? "song" : "songs"}`);
  heading.append(title, count);

  const controls = element("div", "playlist-actions");
  const renameForm = element("form", "rename-playlist-form");
  const renameInput = element("input");
  renameInput.type = "text";
  renameInput.value = playlist.name;
  renameInput.maxLength = 80;
  renameInput.setAttribute("aria-label", `New name for ${playlist.name}`);
  const renameButton = element("button", "text-button", "Rename");
  renameButton.type = "submit";
  renameForm.append(renameInput, renameButton);
  renameForm.addEventListener("submit", async event => {
    event.preventDefault();
    playlistStatus.textContent = "";
    try {
      await api(`/api/me/playlists/${encodeURIComponent(playlist.id)}`, {
        method: "PATCH",
        body: JSON.stringify({ name: renameInput.value })
      });
      await loadPlaylists();
      playlistStatus.textContent = "Playlist renamed.";
    } catch (error) {
      playlistStatus.textContent = error.message;
    }
  });

  const deleteButton = element("button", "text-button danger-button", "Delete");
  deleteButton.type = "button";
  deleteButton.addEventListener("click", async () => {
    if (!window.confirm(`Delete “${playlist.name}” and its songs? This cannot be undone.`)) return;
    playlistStatus.textContent = "";
    try {
      await api(`/api/me/playlists/${encodeURIComponent(playlist.id)}`, { method: "DELETE" });
      await loadPlaylists();
      playlistStatus.textContent = `${playlist.name} deleted.`;
    } catch (error) {
      playlistStatus.textContent = error.message;
    }
  });
  controls.append(renameForm, deleteButton);

  const songList = element("div", "playlist-songs-list");
  if (!playlist.songs.length) {
    songList.append(element("p", "playlist-empty", "This mixtape is still waiting for its first song."));
  }
  playlist.songs.forEach(song => {
    songList.append(renderSongRow(song, {
      onRemove: async () => {
        try {
          await api(`/api/me/playlists/${encodeURIComponent(playlist.id)}/songs/${encodeURIComponent(song.id)}`, {
            method: "DELETE"
          });
          await loadPlaylists();
          playlistStatus.textContent = `${song.title} removed from ${playlist.name}.`;
        } catch (error) {
          playlistStatus.textContent = error.message;
        }
      }
    }));
  });

  const addForm = element("form", "add-song-form");
  const songSelect = document.createElement("select");
  songSelect.setAttribute("aria-label", `Choose a song to add to ${playlist.name}`);
  const placeholder = element("option", "", "Choose a song from the catalogue…");
  placeholder.value = "";
  songSelect.append(placeholder);
  catalogueSongs.forEach(song => {
    const option = element("option", "", `${song.title} — ${song.artist}`);
    option.value = song.id;
    songSelect.append(option);
  });
  const addButton = element("button", "button button-dark", "Add song");
  addButton.type = "submit";
  addForm.append(songSelect, addButton);
  addForm.addEventListener("submit", async event => {
    event.preventDefault();
    if (!songSelect.value) {
      playlistStatus.textContent = "Choose a song first.";
      return;
    }
    try {
      await api(`/api/me/playlists/${encodeURIComponent(playlist.id)}/songs`, {
        method: "POST",
        body: JSON.stringify({ songId: songSelect.value })
      });
      await loadPlaylists();
      playlistStatus.textContent = "Song added to your playlist.";
    } catch (error) {
      playlistStatus.textContent = error.message;
    }
  });

  card.append(heading, controls, songList, addForm);
  return card;
}

async function loadPlaylists() {
  const result = await api("/api/me/playlists");
  const playlists = await Promise.all(result.playlists.map(loadPlaylistDetails));
  playlistList.replaceChildren(...playlists.map(renderPlaylist));
  playlistsEmpty.hidden = playlists.length > 0;
}

async function showLibrary(user) {
  loading.hidden = true;
  errorPanel.hidden = true;
  authPanel.hidden = true;
  libraryPanel.hidden = false;
  document.querySelector("#account-email").textContent = user.email;
  try {
    const [favorites, catalogue] = await Promise.all([
      api("/api/me/favorites"),
      api("/api/songs?limit=50&offset=0")
    ]);
    catalogueSongs = catalogue.songs;
    renderFavorites(favorites.songs);
    await loadPlaylists();
  } catch (error) {
    showError(error);
  }
}

async function loadLibrary() {
  loading.hidden = false;
  authPanel.hidden = true;
  libraryPanel.hidden = true;
  errorPanel.hidden = true;
  try {
    const result = await api("/api/me");
    await showLibrary(result.user);
  } catch (error) {
    loading.hidden = true;
    if (error.status === 401) {
      authPanel.hidden = false;
      setAuthMode(authMode);
    } else {
      showError(error);
    }
  }
}

document.querySelector("#show-login").addEventListener("click", () => setAuthMode("login"));
document.querySelector("#show-register").addEventListener("click", () => setAuthMode("register"));
document.querySelector("#library-retry").addEventListener("click", loadLibrary);

authForm.addEventListener("submit", async event => {
  event.preventDefault();
  const submit = document.querySelector("#auth-submit");
  submit.disabled = true;
  authStatus.textContent = "";
  const values = new FormData(authForm);
  try {
    const result = await api(`/api/auth/${authMode === "login" ? "login" : "register"}`, {
      method: "POST",
      body: JSON.stringify({
        email: values.get("email"),
        password: values.get("password")
      })
    });
    authForm.reset();
    await showLibrary(result.user);
  } catch (error) {
    authStatus.textContent = error.message;
  } finally {
    submit.disabled = false;
  }
});

document.querySelector("#sign-out").addEventListener("click", async () => {
  accountStatus.textContent = "";
  try {
    await api("/api/auth/logout", { method: "POST" });
    authPanel.hidden = false;
    libraryPanel.hidden = true;
    setAuthMode("login");
    authStatus.textContent = "You have signed out.";
  } catch (error) {
    accountStatus.textContent = error.message;
  }
});

createPlaylistForm.addEventListener("submit", async event => {
  event.preventDefault();
  const name = document.querySelector("#new-playlist-name");
  playlistStatus.textContent = "";
  try {
    await api("/api/me/playlists", {
      method: "POST",
      body: JSON.stringify({ name: name.value })
    });
    name.value = "";
    await loadPlaylists();
    playlistStatus.textContent = "Your private playlist is ready.";
  } catch (error) {
    playlistStatus.textContent = error.message;
  }
});

loadLibrary();
