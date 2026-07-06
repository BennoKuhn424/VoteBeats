# Speeldit — Live, Deployed, Revenue-Ready SaaS (Turnkey)

**Asking: $2,500** · Open to first reasonable offer · Full migration & handover included

A fully built, **currently-live** music-voting SaaS for bars, restaurants, and venues.
Customers scan a QR code to vote on and request songs; venue owners manage the queue
and pay a monthly subscription. Payments are wired and working. **Deploy is already
done — speeldit.com is live right now.**

---

## Why this is turnkey (not just code)

Most listings hand you a zip file and wish you luck. This one is **already running in
production**, so the "will it even work / can I deploy it" risk is gone before you buy:

- **Live domain:** [speeldit.com](https://speeldit.com) on Vercel — responds, serves the app
- **Live backend + database:** Node/Express API on Render with a persistent SQLite DB
- **Payments wired and tested — South Africa AND international:**
  - **Yoco** — customer pay-to-play (patrons pay R5–R50 to request a song)
  - **Paystack** — venue monthly subscriptions (R599/mo plan, 14-day free trial)
  - **Stripe** — drop-in replacement for both: pay-to-play checkouts in any currency
    (`PAYMENT_CURRENCY`) plus venue subscriptions with trials and the hosted Billing
    Portal. Switch vendors with two env vars — no code changes. **This product is not
    locked to the South African market.**
- **Real product depth:** ~17,500 lines of production code plus ~10,000 lines of test code — **890 automated tests, all passing** (877 unit + 13 Playwright end-to-end) — and a clean production build
- **10-minute evaluation:** one-click Render blueprint (`render.yaml`) + a demo seed script (`npm run seed-demo`) that fills a venue with a live-looking queue
- **Zero `npm audit` vulnerabilities** in production dependencies (server audit fully clean, dev deps included)
- **Production-hardened:** JWT auth, rate limiting, CORS allowlist, security headers (helmet),
  encrypted pending payments, graceful shutdown, nightly database backups, optional Sentry
- **Apple MusicKit** integration for real song search and venue playback
- **Live updates** via Socket.IO (queue/votes update in real time)
- **Owner dashboard** with revenue split, per-venue breakdown, and live connection count

### Current status: live but pre-revenue
The platform is fully operational with **no active paying venues yet** — it's primed for a
buyer to start signing up venues immediately, or to rebrand and relaunch. Everything works;
it just needs customers.

---

## ✅ Migration & handover — I set it up for you

The live site is currently connected to **my** Yoco and Paystack accounts. As part of the
sale, **I will migrate everything to your accounts and verify it works end-to-end before
handover** — so you're not left guessing whether payments work. Included at no extra cost:

1. **Transfer the codebase** (private repo / full source) and deployment configs.
2. **Repoint payments to your accounts:**
   - Swap in **your Yoco** API keys (customer pay-to-play).
   - Swap in **your Paystack** keys + subscription plan code (venue subscriptions).
   - Re-register the payment **webhooks** to your gateway dashboards.
3. **Re-issue your own secrets** (JWT signing key, payment encryption key, owner login).
4. **Optional Apple Music** — help you generate your own MusicKit key, or run on the
   built-in mock catalog until you're ready.
5. **Live end-to-end test from your accounts** — we run a real test request + a test
   subscription so you watch the money flow into *your* Yoco/Paystack before we call it done.
6. **Handover walkthrough** of the owner dashboard, venue onboarding, and how to add venues.

> Domain options: I can either transfer **speeldit.com** to you, or help you point the
> app at your own new domain — your call.

---

## What's included
- Full source code (frontend + backend + end-to-end tests)
- All deployment configuration (Vercel + Render)
- Documentation: README, backup/restore guide, environment variable reference
- The migration + handover service described above

## What's NOT included
- My personal Yoco / Paystack / Apple accounts and live API keys (you bring your own —
  I migrate the app onto them)
- Any existing customer data (the platform is pre-revenue; the DB starts clean for you)

---

## Tech stack
**Frontend:** React (Vite), Tailwind CSS, React Router, Socket.IO client, qrcode.react
**Backend:** Node.js, Express, SQLite (better-sqlite3, WAL mode), JWT, Socket.IO
**Payments:** Yoco or Stripe (pay-to-play), Paystack or Stripe (subscriptions) — provider-swappable via env var
**Music:** Apple MusicKit
**Hosting:** Vercel (frontend) + Render (backend & database)

---

## Good fit for
- An indie founder or agency wanting a **deployed, payment-ready SaaS** to launch in the
  South African (or any QR-based venue) market without months of build time
- Someone who wants to **rebrand and relaunch** a finished, tested product
- A buyer who values that it's **already live and works** over buying raw, unproven code

---

*Live demo: [speeldit.com](https://speeldit.com) — click around, it's the real app.*
