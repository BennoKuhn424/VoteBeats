# VoteBeats – Full Setup Guide (ngrok / Cloudflare + Apple Music)

> **503 errors with ngrok?** ngrok free tier shows an interstitial that blocks JS chunks. Use **Cloudflare Tunnel** instead (see Part 1.3b).

Complete step-by-step guide to get VoteBeats running with full Apple Music playback via ngrok.

---

## Part 1: Start Your Servers

### 1.1 Start the backend

```powershell
cd c:\Users\benno\VoteBeats\server
npm start
```

You should see: **VoteBeats server running on port 3000**. Leave this terminal open.

---

### 1.2 Start the frontend (new terminal)

```powershell
cd c:\Users\benno\VoteBeats\client
npm run dev -- --host
```

You should see:
- **Local:** http://localhost:5173/
- **Network:** http://10.0.0.xxx:5173/

Leave this terminal open.

---

### 1.3 Start ngrok (new terminal)

```powershell
ngrok http 5173
```

You will see something like:

```
Forwarding    https://xxxxx-xxxxx-xxxxx.ngrok-free.app -> http://localhost:5173
```

**Copy your full ngrok URL** (e.g. `https://myological-kathy-uncomposed.ngrok-free.app`). You will need it in the next steps.

Leave this terminal open.

### 1.3b Alternative: Cloudflare Tunnel (recommended if ngrok gives 503)

ngrok free tier can cause **503 errors** on JS chunks. Cloudflare Tunnel has no interstitial.

1. Install cloudflared: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/
2. Run:
   ```powershell
   cloudflared tunnel --url http://localhost:5173
   ```
3. Copy the `https://xxx.trycloudflare.com` URL. Use this instead of ngrok in Apple Developer.

---

## Part 2: Apple Developer Configuration

### 2.1 Open Apple Developer

1. Go to [developer.apple.com](https://developer.apple.com)
2. Sign in with your Apple ID
3. Click **Account** → **Certificates, Identifiers & Profiles**

---

### 2.2 Check your Media ID (for MusicKit token)

1. In the sidebar, click **Identifiers**
2. Find **Media IDs** in the filter/list
3. Confirm you have a Media ID with **MusicKit** and **Apple Music API** enabled
4. If not, create one:
   - Click **+** → **Media IDs** → Continue
   - Description: `VoteBeats`
   - Identifier: `com.yourcompany.votebeats` (reverse-domain style)
   - Enable **MusicKit** and **Apple Music API**
   - Register

---

### 2.3 Create or update a Services ID (for web domain)

1. In **Identifiers**, click **+** → **Services IDs** → Continue
2. **Description:** `VoteBeats Web`
3. **Identifier:** `com.yourcompany.votebeats.web` (reverse-domain style)
4. Click **Continue** → **Register**
5. Click your new Services ID to edit it
6. Enable **Configure** next to it
7. In **Domains and Subdomains**, add:
   ```
   myological-kathy-uncomposed.ngrok-free.app
   ```
   (Replace with YOUR ngrok subdomain – no `https://`, just the hostname)
8. In **Return URLs**, add (replace with your ngrok URL):
   ```
   https://myological-kathy-uncomposed.ngrok-free.app/
   ```
9. Click **Save**

**Important:** ngrok free URLs change when you restart ngrok. If you get a new URL, come back and update this.

---

## Part 3: Update .env (optional)

If you use payment or redirect URLs, set `PUBLIC_URL` to your ngrok URL:

1. Open `server\.env`
2. Change:
   ```
   PUBLIC_URL=https://myological-kathy-uncomposed.ngrok-free.app
   ```
   (Use your actual ngrok URL)

---

## Part 4: Test the App

### 4.1 Open the app via ngrok

1. On your phone or computer, open: **https://your-ngrok-url.ngrok-free.app**
2. You may see an ngrok warning page – click **Visit Site**
3. You should see VoteBeats

---

### 4.2 Test the Venue Player

1. Go to the home page and enter your venue code (or go directly to `/venue/player/YOUR_VENUE_CODE`)
2. Example: `https://your-ngrok-url.ngrok-free.app/venue/player/H928K4`
3. Sign in with Apple Music when prompted (use an account with an active subscription)
4. Add a song to the queue (from another device or the customer voting page)
5. Tap **Play** on the Venue Player
6. The song should play fully (not stop at 30 seconds)

---

## Part 5: If Something Fails

| Problem | What to do |
|--------|------------|
| **403 Blocked request** | Restart the Vite dev server after changing `vite.config.js`. Ensure `allowedHosts: true` is set. |
| **ngrok URL changed** | Update the Services ID in Apple Developer with the new domain and return URL. |
| **Songs still stop at 30 sec** | Ensure you’re using the ngrok URL (not localhost), that the Services ID domain is correct, and that you’re signed in with an Apple Music subscriber account. |
| **API / token errors** | Confirm `.env` has `APPLE_TEAM_ID`, `APPLE_KEY_ID`, and `APPLE_MUSIC_KEY_PATH` set correctly. |
| **DNS_PROBE_FINISHED_NXDOMAIN** | ngrok might be stopped. Restart `ngrok http 5173` and use the new URL. |

---

## Quick Checklist

- [ ] Backend running on port 3000
- [ ] Frontend running on port 5173 with `--host`
- [ ] ngrok running `ngrok http 5173`
- [ ] ngrok URL added to Apple Services ID (domain + return URL)
- [ ] Media ID has MusicKit enabled
- [ ] Opening app via ngrok URL (not localhost)
- [ ] Signed in with Apple Music (subscriber account)
- [ ] Testing playback from Venue Player
