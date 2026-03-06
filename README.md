# Speeldit – Music Voting Web App (MVP)

Full-stack web app for music voting in bars/restaurants using QR codes. Customers scan to vote and request songs; venue owners manage the queue and settings.

## Tech stack

- **Frontend:** React (Vite), Tailwind CSS, React Router, Axios, date-fns, qrcode.react
- **Backend:** Node.js, Express, JSON file storage, JWT auth, CORS
- **Deploy:** Frontend → Vercel/Netlify; Backend → Render/Railway

## Project structure

```
speeldit/
├── client/          # React frontend
├── server/          # Express API + JSON data
└── README.md
```

## Quick start

### 1. Backend

```bash
cd server
npm install
npm start
```

Server runs at `http://localhost:3000`. Optional env:

- `PORT` – default 3000
- `JWT_SECRET` – for production
- `APPLE_MUSIC_DEVELOPER_TOKEN` – for real Apple Music search (otherwise mock catalog is used)
- `PUBLIC_URL` – frontend URL for redirects (e.g. `https://speeldit.com` or `http://localhost:5173`)
- `YOCO_SECRET_KEY` – Yoco API secret for pay-to-play (get from [Yoco Developer Hub](https://developer.yoco.com/))
- `VENUE_EARNINGS_PERCENT` – Venue share of pay-to-play revenue (default 80)
- `ADMIN_SECRET` – Secret for admin API (see below)

### 2. Frontend

```bash
cd client
npm install
npm run dev
```

App runs at `http://localhost:5173`. The Vite config proxies `/api` to the backend.

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
