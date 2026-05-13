# Code Review — VoteBeats / Speeldit

**Review date:** 2025  
**Scope:** Client (React, VenuePlayer, VenuePlaybackContext), server (Express, queue, auth, payments), shared patterns.

---

## Summary

The codebase is structured and consistent: queue mutations go through `queueRepo` with per-venue locking, playback state is centralized in `VenuePlaybackContext`, and the venue player UI is clear. The items below are improvements and fixes, not fundamental redesigns.

---

## Critical / Security

### 1. **Payment redirect: validate `clientOrigin`**  
**File:** `server/routes/queue.js` (create-payment)  
**Lines:** ~386–396  

`clientOrigin` is taken from the request body and used to build `successUrl`. A client can send any origin and redirect the user after payment to an attacker’s site.

**Improve:** Only allow known origins, e.g.:

- Same origin as `req.headers.origin` when present, or  
- An allowlist from env (e.g. `ALLOWED_ORIGINS`), or  
- Derive from `PUBLIC_URL` and do not accept `clientOrigin` from the body for redirects.

Use the validated origin (or `PUBLIC_URL`) when building `successUrl` / `cancelUrl` / `failureUrl`.

---

### 2. **JWT secret in development**  
**File:** `server/middleware/authMiddleware.js`  
**Line:** 6  

`JWT_SECRET` falls back to a hardcoded string when unset. The production check helps but the fallback is still risky if `NODE_ENV` is ever wrong.

**Improve:** In production, require `JWT_SECRET` and exit if missing. In development, keep the fallback but log a warning so it’s obvious.

---

## High priority / Correctness

### 3. **Media Session: clear position state with `null`**  
**File:** `client/src/context/VenuePlaybackContext.jsx`  
**Line:** ~428  

When not playing, the code called `setPositionState()` with no argument. The spec expects `setPositionState(null)` to clear the position state.

**Status:** Fixed in this pass: use `setPositionState(null)` when clearing.

---

### 4. **VenueLayout: `venueCode` on dashboard**  
**File:** `client/src/layouts/VenueLayout.jsx`  
**Lines:** 10–12  

On `/venue/dashboard` there is no `venueCode` in the URL, so `paramVenueCode` is undefined and `venueCode` comes from `localStorage`. If the user has no stored code or a stale one, `VenuePlaybackProvider` gets `null` and MusicKit init is skipped (which is correct), but the dashboard may still render with an outdated or missing code.

**Improve:** Ensure the dashboard (or login flow) always sets `speeldit_venue_code` when the user selects or logs into a venue. Optionally, on dashboard mount, redirect to login when `!venueCode && !paramVenueCode`.

---

### 5. **Lock-screen queue size**  
**File:** `client/src/context/VenuePlaybackContext.jsx`  
**Line:** ~306  

`LOCK_SCREEN_QUEUE_SIZE` is set to `3` (current + 2 more). Earlier design used 10 for more tracks through lock screen.

**Improve:** Consider increasing back to 10 (or a configurable constant) so more songs can auto-advance when the screen is locked, as long as MusicKit and latency allow.

---

## Medium priority / Robustness

### 6. **Empty `catch` blocks**  
**Files:** multiple  

Examples:

- `VenuePlayer.jsx` line ~93: `handleRemoveSong` — `catch {}`  
- `VenuePlaybackContext.jsx` line ~396: `handleQueueUpdate` after autofill getQueue — `catch {}`  
- Several `api.*.catch(() => {})` for fire-and-forget calls  

**Improve:** At least log: e.g. `catch (err) { console.warn('Remove song failed', err?.message); }`. For user-facing actions (e.g. remove song), consider a small toast or inline error so the user knows the request failed.

---

### 7. **Queue request body validation**  
**File:** `server/routes/queue.js`  
**Route:** `POST /:venueCode/request`  

The handler assumes `song` (and optionally `song.id`, `song.appleId`, etc.) exists. Missing or malformed `song` can cause 500s or odd behaviour.

**Improve:** Validate early: e.g. require `song`, `song.appleId`, and optionally `song.title` / `song.artist`. Return 400 with a clear message if invalid.

---

### 8. **GET /queue/:venueCode — no rate limiting**  

Any client that knows `venueCode` can poll this endpoint. Under load or abuse this could stress the server and DB.

**Improve:** Add rate limiting (e.g. per IP or per `venueCode`) for GET queue and other public queue endpoints. Prefer a small middleware so all public routes are covered.

---

### 9. **CORS `origin: '*'`**  
**File:** `server/server.js`  
**Line:** 15  

Socket.IO is configured with `cors: { origin: '*' }`. That’s acceptable for development but broad for production.

**Improve:** In production, set `cors.origin` to your real front-end origins (or an allowlist from env). Align with the same allowlist used for payment redirects if possible.

---

## Lower priority / Polish

### 10. **VenuePlayer loading state**  
**File:** `client/src/pages/VenuePlayer.jsx`  
**Lines:** 98–104  

When `!venue`, the page shows a single spinner. If `getVenue` fails, the effect navigates to `/venue/login`; until then the user only sees loading.

**Improve:** Optionally handle “venue fetch failed” (e.g. 404) with a short message and a “Back to dashboard” or “Log in again” button instead of infinite spinner.

---

### 11. **Accessibility (a11y)**  
**Files:** `VenuePlayer.jsx`, controls in `QueueManager` / `PlaylistManager`  

Play/pause, skip, and volume are `<button>`s and inputs, but they don’t always have `aria-label` or `title`. Screen reader and keyboard users may not get clear labels.

**Improve:** Add `aria-label` (e.g. “Play”, “Pause”, “Next track”, “Volume”) to icon-only buttons and ensure the progress bar has an accessible name/role if needed.

---

### 12. **Error priority object duplication**  
**File:** `client/src/context/VenuePlaybackContext.jsx`  

`ERROR_PRIORITY` was moved to module scope (good). The context no longer has a duplicate object; ensure no other file redefines the same mapping.

**Improve:** If you add more error messages, keep them and their priorities in this single place and reference it from any banner/toast logic.

---

### 13. **Server auto-advance interval**  
**File:** `server/server.js`  
**Lines:** 56–88  

A single `setInterval` runs every 5s and iterates all venues. For many venues this could create short bursts of work every 5s.

**Improve:** Consider staggering per-venue (e.g. offset by `venueCode` hash) or moving to a single queue of “next advance” times so only venues that need advancing are processed. Optional until you scale to many venues.

---

## What’s working well

- **queueRepo + lock:** Serialises queue updates per venue and avoids lost updates; `validateQueue` is applied in one place.
- **VenuePlaybackContext:** Clear state machine (NOT_READY, IDLE, TRANSITIONING, PLAYING, PAUSED), refs for synchronous guards, and sensible handling of MusicKit events and background advance.
- **Lock screen:** Pre-loaded queue, Media Session metadata/actions, and `audioSession.type` improve behaviour when the tab is in the background or the device is locked.
- **Visibility and socket:** Visibility-aware polling and socket reconnect on visibility/online keep the client in sync after lock or network changes.
- **Auth:** JWT in header, venue attached to `req`, and 403 when route venue doesn’t match.
- **Payment flow:** Yoco integration with pending payment store and fulfillment path is structured; tightening redirects (see #1) will make it safer.

---

## Quick reference: where to change what

| Topic                    | File(s)                          |
|--------------------------|-----------------------------------|
| Payment redirect safety  | `server/routes/queue.js`          |
| JWT secret               | `server/middleware/authMiddleware.js` |
| Media Session clear       | `client/src/context/VenuePlaybackContext.jsx` (fixed) |
| Lock-screen queue length  | `client/src/context/VenuePlaybackContext.jsx` (LOCK_SCREEN_QUEUE_SIZE) |
| Empty catch / user errors| `VenuePlayer.jsx`, `VenuePlaybackContext.jsx` |
| Request body validation   | `server/routes/queue.js` (request, vote, etc.) |
| Rate limiting            | New middleware + `server/server.js` or queue routes |
| CORS                     | `server/server.js` (Socket.IO and Express if used) |
| Venue not found UX       | `client/src/pages/VenuePlayer.jsx` |
| A11y labels              | `VenuePlayer.jsx`, venue components |
