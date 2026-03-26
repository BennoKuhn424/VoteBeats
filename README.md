# Speeldit – Music Voting Web App (MVP)

Full-stack web app for music voting in bars/restaurants using QR codes. Customers scan to vote and request songs; venue owners manage the queue and settings.

## Tech stack

- **Frontend:** React (Vite), Tailwind CSS, React Router, Axios, date-fns, qrcode.react
- **Backend:** Node.js, Express, JSON file storage, JWT auth, CORS
- **Deploy:** Frontend → Vercel/Netlify; Backend → Render/Railway

## Project structure

```
speeldit/
├── client/          # React frontend (Vite)
├── e2e/             # Playwright end-to-end specs
├── server/
│   ├── app.js       # Express app factory (rate limits, routes, logging) — imported by tests
│   ├── instrument.js # Optional Sentry init (only if SENTRY_DSN)
│   ├── server.js    # HTTP server, Socket.IO, queue auto-advance interval
│   ├── routes/      # queue.js mounts queueVote, queuePayment, queueAutofill helpers
│   ├── utils/yoco.js # Shared Yoco checkout verify + webhook HMAC
│   └── data/        # JSON persistence (dev / small deployments)
├── playwright.config.js
└── README.md
```

## Quick start

### 1. Backend

```bash
cd server
npm install
npm start
```

Server runs at `http://localhost:3000`.

**Health checks (for uptime monitors / load balancers):**

- `GET /health`
- `GET /api/health`  
  JSON: `{ ok, service, ts }`

**Production behaviour:**

- **`trust proxy`** – Set `NODE_ENV=production` and, if the API sits behind a reverse proxy (Render, Railway, nginx), set `TRUST_PROXY_HOPS` (default `1`) so client IP and rate limits are correct.
- **Structured request logs** – Each finished request logs one JSON line to stdout: `method`, `path`, `status`, `ms` (health routes are skipped to reduce noise). Point your host’s log drain at this stream.
- **CORS policy** – In production (`NODE_ENV=production`), the server **requires** an explicit origin allowlist. Set `CORS_ORIGINS` (comma-separated) and/or `PUBLIC_URL` so the server knows which frontends may call the API and connect via Socket.IO. Values are trimmed and trailing slashes are stripped; whitespace-only values are treated as empty. If neither variable resolves to at least one real origin, the server **refuses to start** with a clear error. In development, `localhost:5173` is allowed automatically.

  To verify your production config locally:
  ```bash
  NODE_ENV=production CORS_ORIGINS= PUBLIC_URL= node -e "require('./app')"
  # → throws FATAL: No CORS origins configured for production …
  ```

- **Security headers** – [`helmet`](https://helmetjs.github.io/) is applied to all responses, adding `X-Content-Type-Options`, `Strict-Transport-Security`, `X-Frame-Options`, and other hardening headers. Cross-origin resource/embedder policies are relaxed so the SPA + Socket.IO clients on a different origin keep working.
- **Graceful shutdown** – The process handles `SIGTERM` and `SIGINT`: it stops accepting new connections, closes Socket.IO so clients disconnect cleanly, then exits. A 12-second timeout forces exit if shutdown stalls. This matters on PaaS hosts (Render, Railway, Kubernetes) that send `SIGTERM` before killing the container — without a handler the process would be hard-killed mid-request.
- **Rate limits** – `express-rate-limit` on the API:
  - `/api/auth/*`: `RATE_LIMIT_AUTH_MAX` attempts per 15 minutes per IP (default **40**).
  - Other `/api/*` routes (except auth paths): `RATE_LIMIT_API_MAX` requests per minute per IP (default **500**). Raise this if many customer devices share one public IP (e.g. venue Wi‑Fi NAT).

Optional env (full list):

| Variable | Purpose |
|----------|---------|
| `PORT` | Listen port (default `3000`) |
| `NODE_ENV` | Set to `production` for trust proxy + stricter defaults |
| `CORS_ORIGINS` | Comma-separated allowed origins for CORS (e.g. `https://yourapp.vercel.app`). **Required in production** (along with or instead of `PUBLIC_URL`). Values are trimmed; whitespace-only is rejected. |
| `JWT_SECRET` | **Required in production** – signing venue JWTs |
| `TRUST_PROXY_HOPS` | Trust `X-Forwarded-For` hops (default `1`) |
| `RATE_LIMIT_AUTH_MAX` | Auth route cap per 15 min / IP (default `40`) |
| `RATE_LIMIT_API_MAX` | General API cap per minute / IP (default `500`) |
| `APPLE_MUSIC_DEVELOPER_TOKEN` | Pre-generated Apple Music token (optional if using key file) |
| `PUBLIC_URL` | Frontend URL for redirects (e.g. `https://yourapp.vercel.app`) |
| `YOCO_SECRET_KEY` | Yoco API secret for pay-to-play (Bearer token to verify checkouts) |
| `YOCO_WEBHOOK_SECRET` | Optional `whsec_…` signing secret from Yoco — when set, incoming webhooks must pass HMAC verification (recommended in production) |
| `VENUE_EARNINGS_PERCENT` | Venue revenue share % (default `80`) |
| `ADMIN_SECRET` | Admin API key (header `X-Admin-Key`) |
| `APPLE_TEAM_ID`, `APPLE_KEY_ID`, `APPLE_MUSIC_KEY_PATH` | MusicKit token generation (see below) |
| `SENTRY_DSN` | Optional – [Sentry](https://sentry.io) DSN for API error reporting |
| `SENTRY_ENVIRONMENT` | Optional – label in Sentry (defaults to `NODE_ENV`) |
| `SENTRY_TRACES_SAMPLE_RATE` | Optional – `0`–`1` performance trace sampling (default `0` = off) |

### 2. Frontend

```bash
cd client
npm install
npm run dev
```

App runs at `http://localhost:5173`. The Vite config proxies `/api` to the backend.

**Frontend env:**

| Variable | Purpose |
|----------|---------|
| `VITE_PUBLIC_URL` | Canonical public site URL (optional; falls back to `window.location.origin`) |
| `VITE_API_URL` | **Production:** full API base including `/api`, e.g. `https://api.yoursite.com/api` |
| `VITE_SENTRY_DSN` | Optional – browser Sentry DSN (omit in dev to disable) |
| `VITE_SENTRY_ENVIRONMENT` | Optional – Sentry environment label (defaults to Vite `MODE`) |
| `VITE_SENTRY_TRACES_SAMPLE_RATE` | Optional – `0`–`1`; if `0`, tracing integration is disabled |

### Tests & CI

```bash
# Server (Jest)
cd server && npm test

# Client (Vitest + Testing Library)
cd client && npm test

# From repo root (unit tests: server + client)
npm test

# End-to-end (Playwright – starts API + Vite, needs Chromium once: npx playwright install chromium)
npm run test:e2e
```

GitHub Actions runs **server tests**, **client tests**, **client build**, and **Playwright E2E** (Chromium + system deps) on push/PR to `main`/`master`.

**Sentry (optional):** With `SENTRY_DSN` / `VITE_SENTRY_DSN` set, the API registers `setupExpressErrorHandler` and the SPA initializes `@sentry/react` with an error boundary. Without DSNs, Sentry code paths are skipped.

**Still out of scope for the repo:** replacing JSON files with a hosted database, full React Query data layer, and deeper E2E (register → login → playlist) — add those as separate milestones if you need them.

### Platform owner dashboard

The **platform owner** (you) signs in on the same **Venue login** page (`/venue/login`). If credentials match server env, you are sent to **`/owner`** with a full-screen dashboard: total and monthly revenue, **your platform cut** vs **venue share** (from `VENUE_EARNINGS_PERCENT`), per-venue monthly breakdown, all registered venues, recent payments, analytics event volume (24h), and **live Socket.IO connection count** (approximate “active” clients).

**Required server environment (never commit real passwords to git):**

| Variable | Purpose |
|----------|---------|
| `OWNER_EMAIL` | Your login email (single platform owner) |
| `OWNER_PASSWORD_HASH` | Bcrypt hash of your password — **not** plain text |

If `OWNER_EMAIL` is set on the API but **`OWNER_PASSWORD_HASH` is missing**, login with that email returns **503** (not a venue login). If both are set, that email **never** logs in as a venue—only the owner dashboard—so an old venue row with the same email cannot shadow owner login.

Generate the hash locally:

```bash
cd server
npm run hash-owner-password -- "your-password-here"
```

Paste the printed hash into `OWNER_PASSWORD_HASH` on your host (e.g. Render). Restart the API.

Registration is blocked for the same email as `OWNER_EMAIL` so it stays reserved for you.

### 3. Try it

1. Open http://localhost:5173
2. Click “Log in to your dashboard” → Register a venue (email, venue name, password)
3. In the dashboard you’ll see your **venue code** and a **QR code** linking to `/v/YOUR_CODE`
4. Open the voting page (e.g. http://localhost:5173/v/YOUR_CODE) in another tab or on your phone
5. Search for a song (mock catalog: e.g. “Jehovah”, “Ke Star”) and request it; then upvote/downvote in the queue

## API overview

- **Auth:** `POST /api/auth/register`, `POST /api/auth/login`
- **Queue:** `GET /api/queue/:venueCode`, `POST /api/queue/:venueCode/request`, `POST /api/queue/:venueCode/create-payment`, `GET /api/queue/:venueCode/request-status`, `POST /api/queue/:venueCode/vote`, `POST /api/queue/:venueCode/skip`, `DELETE /api/queue/:venueCode/song/:songId`
- **Token:** `GET /api/token` – MusicKit JWT (no auth)
- **Search:** `GET /api/search?q=...&venueCode=...` (venueCode optional)
- **Music:** `GET /api/music/search?q=...&venueCode=...` (legacy)
- **Venue:** `GET /api/venue/:venueCode`, `PUT /api/venue/:venueCode/settings`, `GET /api/venue/:venueCode/earnings` (auth required)
- **Admin:** `GET /api/admin/venue-earnings?year=2025&month=2` (requires `X-Admin-Key: <ADMIN_SECRET>` header)
- **Owner:** `GET /api/owner/overview` (requires `Authorization: Bearer <token>` from owner login — JWT with `role: 'owner'`)

## Data (server/data/)

- `venues.json` – venue info and owner credentials
- `queues.json` – now playing + upcoming per venue
- `votes.json` – vote state per venue/song/device
- `pendingPayments.json` – Yoco checkout IDs awaiting webhook confirmation

Songs auto-advance when their duration ends (server checks every 5s). Next song is chosen by highest votes.

## Deployment

### Frontend (e.g. Vercel)

1. `cd client && npm run build`
2. Deploy the `client` folder (or connect Git and set root to `client`)
3. Set env: `VITE_API_URL=https://your-backend.onrender.com/api`

### Backend (e.g. Render)

1. Connect repo; root = `server`
2. Build: (none). Start: `node server.js`
3. Env: `JWT_SECRET`, `PUBLIC_URL` (frontend URL), optionally `APPLE_MUSIC_DEVELOPER_TOKEN`, `YOCO_SECRET_KEY`

## Apple MusicKit Integration

For real search and full playback:

1. **Apple Developer account** – create a MusicKit identifier and generate a private key (.p8)
2. **Add to `server/.env`:**
   ```
   APPLE_TEAM_ID=[YOUR_TEAM_ID]
   APPLE_KEY_ID=[YOUR_KEY_ID]
   APPLE_MUSIC_KEY_PATH=[PATH_TO_P8_FILE]
   ```
   Example: `APPLE_MUSIC_KEY_PATH=./AuthKey_XXXXXXXX.p8` (relative to server folder)
3. The backend generates a JWT developer token at `/api/token` (ES256, 180-day expiry)
4. **Venue Player:** Open `/venue/player/YOUR_VENUE_CODE` on the device that plays music, click "Authorize Apple Music" once, then leave it open. It polls the queue every 5s and auto-plays requested songs.

Legacy: You can still set `APPLE_MUSIC_DEVELOPER_TOKEN` if you prefer a pre-generated token. Without either, mock catalog is used for search (playback requires real credentials).

## Pay-to-play (Yoco)

Venue owners can enable “Require payment to suggest a song” in Settings. Customers then pay (R5–R50) via Yoco Checkout before their request is added to the queue.

1. Sign up at [Yoco](https://www.yoco.com/) and get API keys from the [Developer Hub](https://developer.yoco.com/).
2. Set `YOCO_SECRET_KEY` (use `sk_test_...` for testing) and `PUBLIC_URL` on the server.
3. Register your webhook URL `https://your-backend.com/api/webhooks/yoco` in the Yoco dashboard (see [webhooks guide](https://developer.yoco.com/guides/online-payments/webhooks)).

## License

MIT
