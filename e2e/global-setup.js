/**
 * Playwright global setup — seeds the E2E environment with a real venue.
 *
 * The customer-voting specs need a venue that actually exists: the API
 * returns 404 for unknown venue codes, so an unseeded run would show
 * "Venue not found" instead of the voting page. We register a fresh venue
 * through the public API (webServer is already up when globalSetup runs)
 * and hand its code to the specs via process.env.E2E_VENUE_CODE.
 *
 * Note: without RESEND_API_KEY on the dev API the account is auto-verified;
 * with it set, the venue still exists for queue reads — either way the
 * voting page works. Each run adds one venue to the local dev DB.
 */

const API_BASE = 'http://127.0.0.1:3000';

async function waitForApi(deadlineMs = 60_000) {
  const deadline = Date.now() + deadlineMs;
  let lastErr;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${API_BASE}/health`);
      if (res.ok) return;
      lastErr = new Error(`health returned ${res.status}`);
    } catch (err) {
      lastErr = err;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`E2E global setup: API never became healthy — ${lastErr?.message}`);
}

export default async function globalSetup() {
  await waitForApi();

  const res = await fetch(`${API_BASE}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: `e2e+${Date.now()}@speeldit.test`,
      password: 'e2e-password-123',
      venueName: 'E2E Test Venue',
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.venueCode) {
    throw new Error(`E2E global setup: venue registration failed (${res.status}): ${JSON.stringify(body)}`);
  }

  process.env.E2E_VENUE_CODE = body.venueCode;
  console.log(`[E2E] Registered test venue: ${body.venueCode}`);
}
