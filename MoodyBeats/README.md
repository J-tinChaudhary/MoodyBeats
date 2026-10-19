# MoodyBeats

MoodyBeats is a desi music-discovery website with the feel of a chai tapri, a vintage radio, and a long ride across town. The project name is a working title; domain, social-handle, and trademark availability must be checked separately before commercial use.

## What is implemented

- Responsive editorial homepage, collection pages, song search, mood/genre filters, and pagination.
- Twelve database-backed desi collections and a starter catalogue of 20 song entries. The song and performer-credit data came from the existing project seed and has not been independently verified here.
- Searchable artist discovery based on those catalogue credits. This is not live Spotify search and does not claim to provide artist profiles.
- One visible Spotify embed slot, populated only when a catalogue row has a valid-shaped Spotify track ID. The starter seed contains **no verified Spotify track IDs**, so songs currently show a Spotify search fallback rather than an embed.
- Email/password accounts independent of Spotify login; password hashes are stored with bcrypt.
- Private account favorites and playlists with server-side ownership checks.
- PostgreSQL-backed data, repeatable numbered migrations, and a repeatable catalogue seed.

The seed contains 20 song rows; the collection membership counts are tested from that seed. Multiple collections intentionally reuse songs. The catalogue is a small starter set—not a claim of 8 verified tracks per collection.

## Beginner-friendly architecture

The browser pages are ordinary HTML, CSS, and JavaScript—there is no frontend build step. The browser requests JSON from the Express server. Express validates requests and calls parameterized SQL in PostgreSQL. PostgreSQL is the source of truth for songs, collections, user accounts, favorites, playlists, and server-side login sessions.

The pages and API should be served from the same site origin. Login writes are intentionally limited to same-origin requests. The app does not have email verification or password-reset delivery; setting those up requires a real email service and is future work.

## Folder layout

```text
MoodyBeats/
├── index.html                 # Discovery homepage
├── playlist.html              # Database-backed collection page
├── library.html               # Sign-in and personal library
├── style.css                  # Responsive visual design
├── script.js                  # Homepage and collection behavior
├── library.js                 # Account and personal-library behavior
├── server.js                  # Express server and PostgreSQL sessions
├── src/
│   ├── app.js                 # REST endpoints, security, and validation
│   ├── config.js              # Startup configuration checks
│   ├── database.js            # PostgreSQL connection pool
│   └── repository.js          # Parameterized database queries
├── migrations/                # Numbered database schema changes
├── seeds/catalogue.sql        # Repeatable starter songs and collections
├── scripts/                   # Migration and seed commands
└── test/                      # API, database, and optional PostgreSQL tests
```

## Run locally on Windows

### Prerequisites

- Node.js 22 or newer.
- PostgreSQL installed and running locally.

### 1. Create a database

In pgAdmin's Query Tool, create a local user and database (replace the sample password with one you choose on your computer):

```sql
CREATE USER moodybeats_local WITH PASSWORD 'choose-a-local-password';
CREATE DATABASE moodybeats OWNER moodybeats_local;
```

If you already created them, do not run those `CREATE` statements again. The project keeps the pre-existing `chai_and_song` database name in `.env.example` for compatibility with existing local installs; you can keep using that database instead of renaming or recreating it.

### 2. Configure and install

In PowerShell, open the project folder and run:

```powershell
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
npm ci
```

Edit `.env` locally:

- Set `DATABASE_URL` to your PostgreSQL database URL and password.
- Set `SESSION_SECRET` to a private random value of at least 32 characters. You can generate one in PowerShell with:

  ```powershell
  [Convert]::ToBase64String([Security.Cryptography.RandomNumberGenerator]::GetBytes(48))
  ```

Keep `.env` private; Git ignores it. Do not paste its values into chat or commit them. `.env.example` contains placeholders only.

### 3. Migrate, seed, and run

```powershell
npm run db:setup
npm start
```

Open <http://localhost:3000>. Use **Ctrl+C** in the terminal to stop the server. For automatic restarts during development, use `npm run dev` instead of `npm start`.

`npm run db:setup` applies numbered migrations once, then runs the repeatable seed. The seed updates its own catalogue rows and collection links; it does not set guessed Spotify IDs.

## Environment variables

| Name | Required | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | Yes | PostgreSQL URL; used only by the server. |
| `SESSION_SECRET` | Yes | Private signing key for login-session cookies; minimum 32 characters. |
| `PORT` | No | HTTP port; defaults to `3000`. |
| `NODE_ENV` | No | Defaults to `development`; production enables secure cookies. |
| `ALLOWED_ORIGINS` | No | Exact origins allowed to make cross-origin read requests. Account writes remain same-origin. |
| `API_BASE_URL` | No | Public API origin if the served frontend needs a separate API origin. Leave empty for the normal same-origin setup. |
| `PGSSLMODE` | No | Set to `require` when your PostgreSQL host requires TLS. |
| `SPOTIFY_CLIENT_ID` | No | Spotify Developer application Client ID. Enables live search across 100M+ songs. |
| `SPOTIFY_CLIENT_SECRET` | No | Spotify Developer application Client Secret. |
| `TEST_DATABASE_URL` | No | Separate disposable PostgreSQL database for the optional real-PostgreSQL integration test. |

The server reports missing or invalid configuration at startup without printing the session secret or database URL.

## API overview

All routes are under `/api`; errors are JSON with an error code and message. Song and artist lists are paginated, and the server limits maximum result sizes. Search and filters are parameterized in SQL.

| Method and path | Purpose |
| --- | --- |
| `GET /api/health` | Check API/database connectivity. |
| `GET /api/filters` | List mood and genre filters. |
| `GET /api/songs?q=&mood=&genre=&collection=&limit=&offset=` | Search/filter songs. |
| `GET /api/songs/:id` | Get one catalogue song. |
| `GET /api/spotify/status` | Check if Spotify API credentials are configured. |
| `GET /api/spotify/search?q=&limit=&offset=` | Live search Spotify's catalog for tracks. |
| `POST /api/spotify/save` | Save a Spotify track to user's favorites and library. |
| `GET /api/collections` | List collections and song counts. |
| `GET /api/collections/:id` | Get a collection and its filtered songs. |
| `GET /api/artists?q=&limit=&offset=` | Search performer credits appearing in catalogue rows. |
| `POST /api/auth/register` | Register with `{ "email": "...", "password": "..." }`. |
| `POST /api/auth/login` | Sign in with email and password. |
| `POST /api/auth/logout` | Sign out and destroy the server-side session. |
| `GET /api/me` | Get the signed-in account. |
| `GET /api/me/favorites` | List the current user's saved songs. |
| `PUT` / `DELETE /api/me/favorites/:songId` | Save or remove a favorite. |
| `GET` / `POST /api/me/playlists` | List or create the current user's private playlists. |
| `GET` / `PATCH` / `DELETE /api/me/playlists/:id` | View, rename, or delete an owned playlist. |
| `POST /api/me/playlists/:id/songs` | Add a song using `{ "songId": "kasoor" }`. |
| `DELETE /api/me/playlists/:id/songs/:songId` | Remove a song from an owned playlist. |

Examples:

```text
http://localhost:3000/api/health
http://localhost:3000/api/songs?q=Anuv%20Jain&mood=heartbreak&genre=indie
http://localhost:3000/api/collections/chai-chill
http://localhost:3000/api/artists?q=Anuv%20Jain
```

Account endpoints require a signed session cookie. Passwords are never returned; only salted bcrypt hashes are stored. Playlist and favorite database operations always include the session user's ID, so another account cannot read or modify those records. Login attempts are rate-limited. Playlists are private by default and are not shareable.

## Collections and catalogue status

The starter seed defines: Chai Ki Tapri, Bus Safar, Radio, Old Is Gold, Baarish Ki Khidki, Shaam-e-Ishq, Dil Se Desi, Galiyon Ke Geet, Nukkad Indie, Raat Ki Local, Sunday Doordarshan, and Safar-e-Sufi.

The catalogue has **20 seeded song entries**, **12 seeded collections**, and **13 distinct credited-artist strings**. Song titles and artist credits are inherited from the previous project's sample seed; they have not been independently checked against authoritative releases in this implementation. Artist discovery groups those credited strings, so a row listing several performers may appear as one joint credit. No live Spotify artist lookup is implemented. Add a verified artist source and confirm current Spotify API access/terms before adding live results.

Current seed coverage (song entries and distinct artist-credit strings per collection; **not verified songs or artist profiles**):

| Collection | Song entries | Credited artist strings |
| --- | ---: | ---: |
| Baarish Ki Khidki | 7 | 6 |
| Bus Safar | 7 | 5 |
| Chai Ki Tapri | 6 | 5 |
| Dil Se Desi | 9 | 6 |
| Galiyon Ke Geet | 5 | 4 |
| Nukkad Indie | 5 | 2 |
| Old Is Gold | 0 | 0 |
| Raat Ki Local | 6 | 4 |
| Radio | 8 | 7 |
| Safar-e-Sufi | 4 | 4 |
| Shaam-e-Ishq | 10 | 9 |
| Sunday Doordarshan | 0 | 0 |

Old Is Gold and Sunday Doordarshan are intentionally left empty: the inherited seed has no suitable retro or family-viewing-era entries, and the project does not invent songs to fill them. All 20 inherited song entries and their credits still need independent verification; the number of verified tracks and verified artist profiles is **zero**.

Current collection membership counts can be checked locally with:

```sql
SELECT c.title, COUNT(cs.song_id) AS song_count
FROM collections c
LEFT JOIN collection_songs cs ON cs.collection_id = c.id
GROUP BY c.id, c.title
ORDER BY c.title;
```

## Spotify embeds and copyright

The site uses Spotify's official iframe embed pattern only for a track row that has a valid 22-character Spotify track ID. The backend constructs the embed URL from the ID; it does not accept arbitrary iframe URLs. The homepage uses one shared player area rather than loading an iframe in every song card. Without a track ID, selecting a song shows an explicit unavailable-for-embed message and a Spotify search link; it does not pretend that an embed is playing.

No Spotify track IDs have been verified or seeded, and no real-track playback test has been performed. To add an embed, find the exact track in Spotify, verify its title and artist, copy its track link, and update only the matching database row with the verified ID. Do not store a search-result URL as a track ID. Availability and playback are controlled by Spotify and vary by track, region, account, and Spotify's terms. An embed is not permission to download, proxy, hide, or re-stream audio, nor does it automatically authorize every commercial use.

This project does not use Spotify login or Spotify's Web API. It does not scrape Spotify. The current artist search only searches the local catalogue's credited artist strings. Review Spotify's current official documentation and terms before changing that: [Spotify Embeds](https://developer.spotify.com/documentation/embeds), [Creating an Embed](https://developer.spotify.com/documentation/embeds/tutorials/creating-an-embed), [Web API Search](https://developer.spotify.com/documentation/web-api/reference/search), and [Developer Terms](https://developer.spotify.com/terms).

The visual covers are CSS-generated and are not album artwork. Do not add copyrighted cover art or images without permission.

## Tests

Run the existing Node test suite:

```powershell
npm test
```

It covers configuration, API validation and combined filters, seeded collections and artists, Spotify URL construction, password hashing, login/logout, favorites, playlist CRUD, and attempts by one account to access another account's library.

The optional real-PostgreSQL integration test requires a separate disposable database. Set `TEST_DATABASE_URL` in PowerShell before running the suite. The test creates and removes a temporary schema, so never point it at a database containing data you need to keep.

## Deployment preparation (not deployed)

The app needs a Node.js host that can run `npm start` and a PostgreSQL database. The simplest setup serves the frontend and API from the **same HTTPS origin**, which also matches the same-origin account-write protection. No deployment provider, account, or price plan is selected or verified here; free plans, quotas, and terms change, so check a provider's current official pricing, service limits, TLS requirements, and cookie/proxy configuration before choosing it.

For a deployment you arrange yourself:

1. Provision PostgreSQL and copy its connection URL into the server host's private `DATABASE_URL` setting.
2. Add a private random `SESSION_SECRET` of at least 32 characters and set `NODE_ENV=production`. Do not put either value in frontend files.
3. Install with `npm ci`, run `npm run db:setup` once against the intended database, and start with `npm start`. The host must supply its port through `PORT`.
4. Prefer serving the HTML pages and API from the same HTTPS origin. If you configure a separate public API origin, set `API_BASE_URL` in the server environment and exact origins in `ALLOWED_ORIGINS`; verify the resulting cookie and browser setup before relying on sign-in.
5. Check `/api/health`, sign-in, favorites, playlist ownership, collection search, and mobile layout on the actual hosted site. Nothing has been deployed or checked live by this project task.

## Portfolio screenshots and live URL

Add desktop and mobile screenshots after capturing the running site, then add a live URL only after you deploy and verify it yourself:

- **Live demo:** _Add after deployment and live checks._
- **Desktop screenshot:** _Add after capturing._
- **Mobile screenshot:** _Add after capturing._
