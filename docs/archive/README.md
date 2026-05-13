# Archive

Pre-launch docs kept for historical context. **Do not treat as current.**

- `NGROK_SETUP.md` — instructions for exposing the local dev server via ngrok
  while we tested on phones. Now superseded by the live deployment at
  `https://speeldit.com` (frontend → Vercel) and `https://api.speeldit.com`
  (backend → Render). The current README + `VERCEL_DEPLOY.md` describe the
  real setup.

- `CODE_REVIEW.md` — a code-review checklist from March 2026, before the
  SQLite migration, before Paystack subscriptions, before the per-venue
  async mutex, and before the provider factory pattern. Most line numbers
  and many recommendations no longer apply. Kept for historical context;
  any item worth revisiting should be re-evaluated against the current code.
