/**
 * @jest-environment node
 *
 * Route tests for the paid AI-playlist flow:
 *   POST /api/venue/:code/playlists/:id/generate-checkout   (take the money)
 *   POST /api/venue/:code/playlists/:id/generate            (deliver the goods)
 *
 * The DB-level pieces (claimCheckout, the orphan ledger) are covered in
 * checkoutReplayGuard.test.js. What is only provable here is the wiring: that
 * the checkout is created at the ACTIVE provider, that redirect URLs come from
 * the server's allowlist rather than the caller, that a spent receipt is
 * refused, and — most importantly — that a failed generation gives the receipt
 * back and books the money as owed instead of silently keeping it.
 */

jest.mock('../utils/database');
jest.mock('../utils/broadcast');
jest.mock('../utils/logEvent', () => ({ logEvent: jest.fn() }));
jest.mock('../routes/queueAutofill', () => ({
  serverAutofill: jest.fn().mockResolvedValue(undefined),
  autofillIfQueueEmpty: jest.fn(),
  attachAutofillRoutes: jest.fn((router) => router),
}));
jest.mock('../utils/appleMusicToken', () => ({ getToken: jest.fn().mockResolvedValue('mock-token') }));

const mockPatronProvider = {
  name: 'testpay',
  isConfigured: jest.fn(() => true),
  createCheckout: jest.fn(),
  verifyCheckout: jest.fn(),
};
jest.mock('../providers/payment', () => ({
  getProvider: () => mockPatronProvider,
  _resetProviderForTests: jest.fn(),
}));

const mockSearchProvider = { search: jest.fn() };
jest.mock('../providers', () => ({ getProvider: () => mockSearchProvider }));

const request = require('supertest');
const jwt = require('jsonwebtoken');
const db = require('../utils/database');
const { app } = require('../app');

const JWT_SECRET = process.env.JWT_SECRET || 'speeldit-dev-secret-change-in-production';
const VENUE = 'GEN001';
const PLAYLIST = 'pl_target';

function authed(path) {
  const token = jwt.sign({ venueCode: VENUE, csrf: 'csrf-tok', jti: 'jti-1' }, JWT_SECRET, { expiresIn: '7d' });
  return request(app)
    .post(path)
    .set('Cookie', `auth_token=${token}`)
    .set('X-CSRF-Token', 'csrf-tok');
}

const checkoutUrl = `/api/venue/${VENUE}/playlists/${PLAYLIST}/generate-checkout`;
const generateUrl = `/api/venue/${VENUE}/playlists/${PLAYLIST}/generate`;

function venueRecord() {
  return {
    code: VENUE,
    name: 'Generation Bar',
    settings: {},
    playlists: [{ id: PLAYLIST, name: 'Target', songs: [] }],
    activePlaylistId: PLAYLIST,
  };
}

/** Distinct catalog results so dedup never caps the count under test. */
function songs(n, seed) {
  return Array.from({ length: n }, (_, i) => ({
    appleId: `ap_${seed}_${i}`,
    title: `Song ${seed}-${i}`,
    artist: `Artist ${seed}-${i}`,
    albumArt: '',
    duration: 180000,
  }));
}

function mockClaudeReturning(queries) {
  global.fetch = jest.fn(async () => ({
    ok: true,
    json: async () => ({ content: [{ text: JSON.stringify({ queries }) }] }),
  }));
}

// Only these are touched per-test. Restoring by key rather than reassigning
// process.env keeps the object identity Node and Jest hold references to.
const MANAGED_ENV = ['ANTHROPIC_API_KEY', 'PUBLIC_URL', 'CORS_ORIGINS'];
const ORIGINAL_ENV = Object.fromEntries(MANAGED_ENV.map((k) => [k, process.env[k]]));

function restoreEnv() {
  for (const k of MANAGED_ENV) {
    if (ORIGINAL_ENV[k] === undefined) delete process.env[k];
    else process.env[k] = ORIGINAL_ENV[k];
  }
}

beforeEach(() => {
  jest.resetAllMocks();
  restoreEnv();
  process.env.ANTHROPIC_API_KEY = 'sk-test';
  delete process.env.PUBLIC_URL;
  delete process.env.CORS_ORIGINS;

  mockPatronProvider.isConfigured.mockReturnValue(true);
  mockPatronProvider.createCheckout.mockResolvedValue({ checkoutId: 'chk_new', redirectUrl: 'https://pay.test/chk_new' });
  mockPatronProvider.verifyCheckout.mockResolvedValue({ verified: true, amountCents: 10000 });

  db.getSubscription.mockReturnValue({ status: 'active' });
  db.getVenue.mockReturnValue(venueRecord());
  db.saveVenue.mockImplementation(() => {});
  db.setPendingPayment.mockImplementation(() => {});
  db.removePendingPayment.mockImplementation(() => {});
  db.isCheckoutConsumed.mockReturnValue(false);
  db.claimCheckout.mockReturnValue(true);
  db.releaseCheckoutClaim.mockReturnValue(true);
  db.recordOrphanedPayment.mockImplementation(() => {});
  db.resolveOrphanedPayment.mockReturnValue(false);

  mockSearchProvider.search.mockResolvedValue(songs(3, 'x'));
  mockClaudeReturning(['jazz', 'blues', 'soul']);
});

afterAll(restoreEnv);

// ── Taking the money ────────────────────────────────────────────────────────

describe('POST .../generate-checkout', () => {
  test('creates the checkout at the ACTIVE patron provider, not a hard-coded one', async () => {
    const res = await authed(checkoutUrl).send({ prompt: 'sunday jazz', count: 50 });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ checkoutId: 'chk_new', redirectUrl: 'https://pay.test/chk_new' });
    expect(mockPatronProvider.createCheckout).toHaveBeenCalledWith(
      expect.objectContaining({ amountCents: 5000, metadata: { venueCode: VENUE } })
    );
  });

  test('stores the pending row as a playlist purchase, priced at R1 per song', async () => {
    await authed(checkoutUrl).send({ prompt: 'sunday jazz', count: 50 });

    expect(db.setPendingPayment).toHaveBeenCalledWith('chk_new', expect.objectContaining({
      kind: 'playlist_generation',
      venueCode: VENUE,
      playlistId: PLAYLIST,
      amountCents: 5000,
      count: 50,
      prompt: 'sunday jazz',
    }));
  });

  test('503s when the provider is not configured, without booking a pending row', async () => {
    mockPatronProvider.isConfigured.mockReturnValue(false);

    const res = await authed(checkoutUrl).send({ prompt: 'jazz', count: 50 });

    expect(res.status).toBe(503);
    expect(mockPatronProvider.createCheckout).not.toHaveBeenCalled();
    expect(db.setPendingPayment).not.toHaveBeenCalled();
  });

  test('404s for a playlist the venue does not have', async () => {
    const res = await request(app)
      .post(`/api/venue/${VENUE}/playlists/pl_nope/generate-checkout`)
      .set('Cookie', `auth_token=${jwt.sign({ venueCode: VENUE, csrf: 'c', jti: 'j' }, JWT_SECRET)}`)
      .set('X-CSRF-Token', 'c')
      .send({ prompt: 'jazz', count: 50 });

    expect(res.status).toBe(404);
    expect(mockPatronProvider.createCheckout).not.toHaveBeenCalled();
  });

  // SECURITY: the post-payment redirect must never be steerable by the caller.
  test('ignores an unlisted clientOrigin when building the redirect URLs', async () => {
    process.env.PUBLIC_URL = 'https://app.speeldit.test';

    await authed(checkoutUrl).send({ prompt: 'jazz', count: 50, clientOrigin: 'https://evil.test' });

    const { successUrl, cancelUrl } = mockPatronProvider.createCheckout.mock.calls[0][0];
    expect(successUrl).toBe('https://app.speeldit.test/venue/playlists?generatePlaylist=1');
    expect(cancelUrl).toBe('https://app.speeldit.test/venue/playlists');
    expect(successUrl).not.toContain('evil.test');
  });

  test('honours a clientOrigin that IS on the server allowlist', async () => {
    process.env.PUBLIC_URL = 'https://app.speeldit.test';
    process.env.CORS_ORIGINS = 'https://tablet.speeldit.test';

    await authed(checkoutUrl).send({ prompt: 'jazz', count: 50, clientOrigin: 'https://tablet.speeldit.test' });

    const { successUrl } = mockPatronProvider.createCheckout.mock.calls[0][0];
    expect(successUrl).toBe('https://tablet.speeldit.test/venue/playlists?generatePlaylist=1');
  });

  // The route used to build these URLs from req.headers.origin. Any HTTP
  // client can set that header, so it must not be read at all — even when the
  // value passes CORS, as localhost does here. (An origin that does NOT pass
  // CORS never reaches the route in the first place.)
  test('the Origin header is not read when building the redirect', async () => {
    process.env.PUBLIC_URL = 'https://app.speeldit.test';

    await authed(checkoutUrl)
      .set('Origin', 'http://localhost:5173')
      .send({ prompt: 'jazz', count: 50 });

    const { successUrl } = mockPatronProvider.createCheckout.mock.calls[0][0];
    expect(successUrl).toBe('https://app.speeldit.test/venue/playlists?generatePlaylist=1');
  });
});

// ── Delivering the goods ────────────────────────────────────────────────────

describe('POST .../generate — replay protection', () => {
  test('a checkout already spent is refused before anything else happens', async () => {
    db.isCheckoutConsumed.mockReturnValue(true);
    db.getPendingPayment.mockReturnValue(null);

    const res = await authed(generateUrl).send({ checkoutId: 'chk_spent', prompt: 'jazz', count: 100 });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('CHECKOUT_ALREADY_USED');
    expect(mockPatronProvider.verifyCheckout).not.toHaveBeenCalled();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('losing the claim race is refused even when the pre-check passed', async () => {
    // Both requests saw isCheckoutConsumed() === false; only one INSERT lands.
    db.claimCheckout.mockReturnValue(false);
    db.getPendingPayment.mockReturnValue({
      kind: 'playlist_generation', venueCode: VENUE, playlistId: PLAYLIST, count: 50, prompt: 'jazz', amountCents: 5000,
    });

    const res = await authed(generateUrl).send({ checkoutId: 'chk_race', prompt: 'jazz', count: 50 });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('CHECKOUT_ALREADY_USED');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('a successful redemption claims the checkout and persists the songs', async () => {
    db.getPendingPayment.mockReturnValue({
      kind: 'playlist_generation', venueCode: VENUE, playlistId: PLAYLIST, count: 50, prompt: 'sunday jazz', amountCents: 5000,
    });

    const res = await authed(generateUrl).send({ checkoutId: 'chk_ok', prompt: 'sunday jazz', count: 50 });

    expect(res.status).toBe(200);
    expect(res.body.added.length).toBeGreaterThan(0);
    expect(db.claimCheckout).toHaveBeenCalledWith('chk_ok', 'playlist_generation', VENUE);
    expect(db.saveVenue).toHaveBeenCalled();
    // Nothing owed — the goods were delivered.
    expect(db.recordOrphanedPayment).not.toHaveBeenCalled();
  });

  test('redeeming late clears the orphan the stale-pending sweep parked', async () => {
    db.getPendingPayment.mockReturnValue(null);

    const res = await authed(generateUrl).send({ checkoutId: 'chk_late', prompt: 'jazz', count: 100 });

    expect(res.status).toBe(200);
    expect(db.resolveOrphanedPayment).toHaveBeenCalledWith('chk_late', expect.any(String));
  });

  test('rejects a pending row belonging to another venue', async () => {
    db.getPendingPayment.mockReturnValue({
      kind: 'playlist_generation', venueCode: 'OTHER1', playlistId: PLAYLIST, count: 50, prompt: 'jazz',
    });

    const res = await authed(generateUrl).send({ checkoutId: 'chk_other', prompt: 'jazz', count: 50 });

    expect(res.status).toBe(403);
    expect(db.claimCheckout).not.toHaveBeenCalled();
  });

  test('rejects a song-request checkout being spent on a playlist', async () => {
    db.getPendingPayment.mockReturnValue({ kind: 'song_request', venueCode: VENUE, amountCents: 1000 });

    const res = await authed(generateUrl).send({ checkoutId: 'chk_song', prompt: 'jazz', count: 50 });

    expect(res.status).toBe(400);
    expect(db.claimCheckout).not.toHaveBeenCalled();
  });
});

describe('POST .../generate — song budget without a pending row', () => {
  // No pending row means the client names its own `count`, so the budget has
  // to be re-derived from what the provider says was actually paid (R1/song).
  test('a R25 payment cannot be redeemed for 400 songs', async () => {
    db.getPendingPayment.mockReturnValue(null);
    mockPatronProvider.verifyCheckout.mockResolvedValue({ verified: true, amountCents: 2500 });
    mockSearchProvider.search.mockImplementation(async (q) => songs(20, q));
    mockClaudeReturning(Array.from({ length: 100 }, (_, i) => `q${i}`));

    const res = await authed(generateUrl).send({ checkoutId: 'chk_cheap', prompt: 'jazz', count: 400 });

    expect(res.status).toBe(200);
    expect(res.body.added.length).toBeLessThanOrEqual(25);
  });

  test('an unverifiable checkout is refused and never claimed', async () => {
    db.getPendingPayment.mockReturnValue(null);
    mockPatronProvider.verifyCheckout.mockResolvedValue({ verified: false });

    const res = await authed(generateUrl).send({ checkoutId: 'chk_unpaid', prompt: 'jazz', count: 100 });

    expect(res.status).toBe(402);
    expect(db.claimCheckout).not.toHaveBeenCalled();
  });

  test('a payment too small to buy a single song is refused', async () => {
    db.getPendingPayment.mockReturnValue(null);
    mockPatronProvider.verifyCheckout.mockResolvedValue({ verified: true, amountCents: 40 });

    const res = await authed(generateUrl).send({ checkoutId: 'chk_dust', prompt: 'jazz', count: 100 });

    expect(res.status).toBe(402);
    expect(db.claimCheckout).not.toHaveBeenCalled();
  });
});

// ── The money must survive a failed delivery ────────────────────────────────

describe('POST .../generate — nothing delivered', () => {
  const pending = {
    kind: 'playlist_generation', venueCode: VENUE, playlistId: PLAYLIST, count: 50, prompt: 'jazz', amountCents: 5000,
  };

  beforeEach(() => {
    // What the provider says was actually charged is what is owed.
    mockPatronProvider.verifyCheckout.mockResolvedValue({ verified: true, amountCents: 5000 });
  });

  test('a Claude outage releases the claim and books the money as owed', async () => {
    db.getPendingPayment.mockReturnValue(pending);
    global.fetch = jest.fn(async () => ({ ok: false, status: 529 }));

    const res = await authed(generateUrl).send({ checkoutId: 'chk_boom', prompt: 'jazz', count: 50 });

    expect(res.status).toBe(500);
    // Released, so the venue can redeem the receipt it already paid for.
    expect(db.releaseCheckoutClaim).toHaveBeenCalledWith('chk_boom');
    // And surfaced, so the owner sees it even if the venue never returns.
    expect(db.recordOrphanedPayment).toHaveBeenCalledWith(expect.objectContaining({
      checkoutId: 'chk_boom',
      venueCode: VENUE,
      amountCents: 5000,
      reason: 'playlist_generation_failed',
    }));
    expect(db.saveVenue).not.toHaveBeenCalled();
  });

  test('an empty AI response is treated the same way', async () => {
    db.getPendingPayment.mockReturnValue(pending);
    mockClaudeReturning([]);

    const res = await authed(generateUrl).send({ checkoutId: 'chk_empty', prompt: 'jazz', count: 50 });

    expect(res.status).toBe(500);
    expect(db.releaseCheckoutClaim).toHaveBeenCalledWith('chk_empty');
    expect(db.recordOrphanedPayment).toHaveBeenCalledWith(
      expect.objectContaining({ checkoutId: 'chk_empty', reason: 'playlist_generation_failed' })
    );
  });

  test('a missing ANTHROPIC_API_KEY does not swallow the payment', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    db.getPendingPayment.mockReturnValue(pending);

    const res = await authed(generateUrl).send({ checkoutId: 'chk_nokey', prompt: 'jazz', count: 50 });

    expect(res.status).toBe(503);
    expect(db.releaseCheckoutClaim).toHaveBeenCalledWith('chk_nokey');
    expect(db.recordOrphanedPayment).toHaveBeenCalledWith(
      expect.objectContaining({ checkoutId: 'chk_nokey', reason: 'playlist_generation_failed' })
    );
  });

  test('a released receipt really is redeemable again', async () => {
    db.getPendingPayment.mockReturnValue(pending);
    global.fetch = jest.fn(async () => ({ ok: false, status: 529 }));
    await authed(generateUrl).send({ checkoutId: 'chk_retry', prompt: 'jazz', count: 50 });

    // Second attempt: the claim was released, so the guard lets it through.
    db.isCheckoutConsumed.mockReturnValue(false);
    db.claimCheckout.mockReturnValue(true);
    mockClaudeReturning(['jazz', 'blues']);
    mockSearchProvider.search.mockResolvedValue(songs(3, 'retry'));

    const res = await authed(generateUrl).send({ checkoutId: 'chk_retry', prompt: 'jazz', count: 50 });

    expect(res.status).toBe(200);
    expect(res.body.added.length).toBeGreaterThan(0);
  });
});
