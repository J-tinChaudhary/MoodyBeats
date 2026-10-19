# MoodyBeats

MoodyBeats is a desi music-discovery website inspired by Indian chai taps, train journeys, retro radio, and late-night city moods. It keeps the existing plain HTML, CSS, and browser JavaScript frontend, and adds an Express API backed by PostgreSQL.

The project name is a working title for this codebase. Before any commercial launch, check domain, social-handle, and trademark availability separately; this README is not a legal or commercial claim of availability.

Implemented features include responsive homepage and collection pages, six database-backed collections, song search by title or artist, combined mood/genre/collection filtering, pagination, loading/empty/error states, and visible Spotify links. A Spotify embed is rendered only for a song with a verified track ID; the starter catalogue intentionally has none, so it currently uses Spotify search links instead.

## How the project fits together

- The browser loads the existing `index.html` and `playlist.html` pages.
- `script.js` calls the same-origin `/api` endpoints and renders songs and collections.
- Express in `server.js` serves those pages and the REST API.
- `src/repository.js` validates query parameters and uses parameterized PostgreSQL queries.
- PostgreSQL is the source of truth for songs, collections, moods, genres, and collection membership. There is no browser-side song catalogue.
- `migrations/` creates the schema. `seeds/catalogue.sql` loads the starter catalogue and can be run again safely.
- Database credentials stay in the server's `.env` file; they are never sent to the browser.

For local development, PostgreSQL runs on your own computer. PostgreSQL is free and open source. Hosting is optional; no deployment provider or paid service is required to run this project locally.

## Folder structure

```text
MoodyBeats/ (the project folder in this workspace)
├── index.html
├── playlist.html
├── style.css
├── script.js
├── config.js
├── package.json
├── package-lock.json
├── server.js
├── .env.example
├── migrations/
│   └── 001_initial_schema.sql
├── seeds/
│   └── catalogue.sql
├── scripts/
│   ├── migrate.js
│   └── seed.js
├── src/
│   ├── app.js
│   ├── config.js
│   ├── database.js
│   └── repository.js
└── test/
    ├── api.test.js
    ├── database.test.js
    └── postgres.integration.test.js
```

## Set up locally on Windows

### 1. Install the prerequisites

- Install Node.js 22 LTS or a newer LTS release from <https://nodejs.org/>. The package declares Node.js 22 as its minimum; this project was checked with Node.js 22.23.3.
- Install PostgreSQL using the official Windows instructions: <https://www.postgresql.org/download/windows/>. The PostgreSQL installer also includes pgAdmin, a graphical tool for managing a local database.

This project does not use Docker or an online database service.

### 2. Create a local database and user

Open pgAdmin's Query Tool on your local PostgreSQL server and run the following, replacing the sample password with a password you choose for this computer:

```sql
CREATE USER chai_song WITH PASSWORD 'choose-a-local-password';
CREATE DATABASE chai_and_song OWNER chai_song;
```

If you already created the user or database, do not run the corresponding `CREATE` command a second time.

### 3. Configure the server

Open a terminal in the project folder:

```powershell
Copy-Item .env.example .env
npm ci
```

For a fresh checkout with the committed lockfile, use `npm ci` instead of `npm install`; it installs the exact dependency versions recorded by the project.

Edit `.env` and update `DATABASE_URL` with the local database password:

```text
DATABASE_URL=postgresql://chai_song:your-password@localhost:5432/chai_and_song
```

If your password contains URL-reserved characters such as `@`, `:`, `/`, or `#`, percent-encode those characters in the URL. Keep `.env` private: it is excluded by `.gitignore`. Do not put credentials in frontend code, screenshots, or a public repository.

### 4. Create the tables and load the sample catalogue

```powershell
npm run db:setup
```

The migration command creates a migration-history table and runs each numbered SQL migration once. The seed command adds or updates the starter songs and collections. Running the seed again is safe. It does not overwrite a manually added Spotify track ID.

### 5. Start the site

For development with automatic server restarts:

```powershell
npm run dev
```

For a normal server run:

```powershell
npm start
```

Visit <http://localhost:3000>. The Express app serves both pages and `/api`, so the local frontend does not need a separate server or CORS configuration. Stop the server with **Ctrl+C**.

## Environment variables

| Variable | Required | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | Yes | PostgreSQL connection URL, used only by Node.js. |
| `PORT` | No | HTTP port; defaults to `3000`. |
| `NODE_ENV` | No | Runtime mode; defaults to `development`. |
| `ALLOWED_ORIGINS` | No | Comma-separated exact browser origins allowed to call the API cross-origin. Leave empty for the same-origin local setup. |
| `API_BASE_URL` | No | Public HTTPS API origin used by Express's generated browser config and Content Security Policy if its served frontend calls a different API origin. Usually leave empty for same-origin hosting. A separately hosted static frontend instead uses its public `config.js`. It is public—not a secret. |
| `PGSSLMODE` | No | Set to `require` when a PostgreSQL host requires TLS. Local PostgreSQL normally does not. |
| `TEST_DATABASE_URL` | No | A separate disposable PostgreSQL database for the integration test. |

The server exits with a clear message if `DATABASE_URL` or another required setting is invalid. `.env.example` contains placeholders, not working credentials.

## REST API

All API responses are JSON. Invalid query parameters return `400`, missing songs/collections return `404`, and health check database failures return `503`. Song lists default to 12 items per page and allow a maximum `limit` of 50. `q`, `mood`, `genre`, and `collection` can be combined.

| Method and path | Description |
| --- | --- |
| `GET /api/health` | Check that the API can reach PostgreSQL. |
| `GET /api/filters` | List the mood and genre options used by the filter controls. |
| `GET /api/songs` | List songs, with optional `q`, `mood`, `genre`, `collection`, `limit`, and `offset` parameters. |
| `GET /api/songs/:id` | Retrieve a single song by its catalogue ID. |
| `GET /api/collections` | List collections and their song counts. |
| `GET /api/collections/:id` | Retrieve one collection and its songs; supports the same search, mood, genre, limit, and offset parameters. |

Examples:

```text
http://localhost:3000/api/health
http://localhost:3000/api/songs?q=Anuv%20Jain&mood=heartbreak&genre=indie
http://localhost:3000/api/songs?collection=chai-chill&limit=6&offset=0
http://localhost:3000/api/collections/rainy-day
http://localhost:3000/api/songs/kasoor
```

Search values are passed to PostgreSQL as query parameters, not concatenated into SQL. Collection, mood, and genre filters apply on the server and can be used together.

## Spotify players and track verification

This project uses Spotify's official visible Embed iframe for a track only when a Spotify track ID has been added to that database row. The backend accepts only the Spotify ID format and constructs the embed URL itself; the browser also checks the embed host and path before creating the iframe. A Spotify link is always shown as a fallback. Until a track ID is configured, the fallback opens Spotify's search for the song title and artist.

**The starter catalogue has no verified Spotify track IDs.** This is deliberate: the original catalogue had song titles and artists but no Spotify links, and the project does not have Spotify API credentials or a reliable verification source. It would be misleading to guess track IDs. As a result, seeded songs initially show a Spotify search link rather than a player. The embed integration becomes active for each song after you verify its link in Spotify and add the corresponding track ID.

To add a verified ID:

1. Find the exact song in Spotify and choose **Share → Copy link**.
2. Check the Spotify track page and confirm it matches the song and artist. A typical link looks like `https://open.spotify.com/track/22-character-track-id`.
3. In pgAdmin, update that song's row with the ID from the link (not the full URL):

   ```sql
   UPDATE songs
   SET spotify_track_id = 'paste-the-verified-22-character-id'
   WHERE id = 'kasoor';
   ```

   Replace both example values with the ID you verified and its matching catalogue row. Do not paste a search URL or an unverified ID. The database rejects IDs that are not 22 characters long.

The embed is visible and interactive; playback stays on Spotify. Playback and availability are controlled by Spotify and can vary by track, region, account, and Spotify's current terms. Spotify embeds do not give this site permission to download, proxy, re-stream, or otherwise host the audio, and embedding does not automatically authorize every commercial use. The app does not use Spotify's Web API, store access tokens, or claim that every track can be played.

Official references: [Spotify Embeds](https://developer.spotify.com/documentation/embeds), [Creating an Embed](https://developer.spotify.com/documentation/embeds/tutorials/creating-an-embed), and [Spotify Developer Terms](https://developer.spotify.com/terms).

## Run tests

API, validation, CORS, and parameterized-query tests use Node's built-in test runner:

```powershell
npm test
```

For the PostgreSQL integration test, create a **separate disposable database** first and set `TEST_DATABASE_URL` in the current PowerShell session:

```powershell
$env:TEST_DATABASE_URL = "postgresql://chai_song:your-password@localhost:5432/chai_and_song_test"
npm test
```

The integration test creates and drops a temporary schema in that database. Do not point it at a database containing data you need to keep. Remove the environment variable afterward with:

```powershell
Remove-Item Env:TEST_DATABASE_URL
```

## Deployment preparation (not deployed)

The complete app has three parts: a static frontend, the Express API, and PostgreSQL. GitHub Pages can host only the static files; it cannot run this Express server or PostgreSQL. A suitable split-host option to investigate is:

- **Frontend: Cloudflare Pages.** Publish the project root as static files with no build command. The official Pages limits currently document 500 builds per month, one concurrent build, a 20-minute build timeout, 20,000 files per site, and a 25 MiB per-file limit. This project is far below the file limits. Pages is only the frontend host here; do not try to deploy Express as Pages Functions.
- **API: Render Web Service.** Render's official pricing page lists a $0/month free compute option for web services (512 MB RAM, less than 1 CPU); free resources have limitations and should not be treated as an uptime guarantee. Recheck current pricing, sleep/cold-start behavior, and limits before you choose it.
- **Database: Neon Postgres.** Neon currently lists a $0 Free plan with no credit card required, 100 CU-hours per project each month, and 1 GB storage per project. Recheck current quotas, inactivity/scale-to-zero behavior, connection limits, and billing terms before creating a database.

These are provider candidates, not endorsements or a guarantee that the free tiers will remain available. The figures and service constraints above were checked against the official provider pages during this review; plans change. Review [Cloudflare Pages limits](https://developers.cloudflare.com/pages/platform/limits/), [Render pricing](https://render.com/pricing) and [free instance docs](https://render.com/docs/free), and [Neon pricing](https://neon.tech/pricing) immediately before deployment. Do not add a payment method or select a paid plan unless you intend to incur charges.

### Manual deployment checklist

1. Create the PostgreSQL database with your chosen provider. Keep its connection URL private.
2. Deploy this project folder as a Node web service. Use `npm ci` as the install command and `npm start` as the start command. Use Node.js 22 or newer. The platform must pass its assigned port through `PORT`.
3. Add these settings to the API host's private environment settings: `DATABASE_URL` (the database connection URL), `NODE_ENV=production`, and `ALLOWED_ORIGINS` (the exact HTTPS origin for the static frontend, with no path or trailing slash). Use the database provider's TLS instructions; `PGSSLMODE=require` is available if appropriate. Never put `DATABASE_URL` in frontend `config.js`.
4. Run `npm run db:setup` once against the new database before opening the site. If the host offers a one-off shell, run it there after setting the private `DATABASE_URL`. Otherwise, make a temporary local `.env` from `.env.example`, put the database URL there, run the command from the project folder, then remove the local `.env`. The project `.gitignore` excludes that file. Do not use a database containing data you need to keep without reviewing the seed's upsert behavior first.
5. For the static frontend, configure the publishing directory as the project root and use no build command. Edit the public `config.js` value to the deployed API origin, for example `https://your-api.example` (origin only, no `/api` suffix), before publishing. This value is public configuration, not a credential. Confirm the API's `ALLOWED_ORIGINS` matches the exact HTTPS frontend origin.
6. Once both services are configured, visit `https://your-api.example/api/health` and confirm the JSON says `{"status":"ok","database":"connected"}`. Then check the frontend's search, combined filters, a collection page, and its Spotify fallback links. These steps are yours to complete; nothing has been deployed, pushed, or published from this project.

If you prefer a single service, Express can serve both the frontend and API; use the Node host for the whole project and leave `API_BASE_URL` and `ALLOWED_ORIGINS` empty. This avoids cross-origin setup, but it does not remove the PostgreSQL hosting requirement.

### Portfolio screenshots and live URL

After you publish it yourself, add a desktop homepage screenshot and a narrow mobile screenshot in a folder such as `assets/screenshots/`, then link them here. Add the public site URL here only after you have deployed and verified it:

- **Live demo:** _Add your URL after deployment and live checks._
- **Screenshots:** _Add links after capturing the desktop and mobile layouts._

No screenshot or live deployment has been produced or verified as part of this review.
