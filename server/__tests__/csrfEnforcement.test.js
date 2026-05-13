/**
 * @jest-environment node
 *
 * CSRF enforcement — proves that PUT/POST/DELETE on authed routes are rejected
 * with 403 when the X-CSRF-Token header is missing or does not match the JWT
 * `csrf` claim, even if a valid auth_token cookie is present.
 *
 * Positive coverage (the JWT carries a csrf claim, csrf_token cookie matches)
 * exists in security.test.js. This file adds the negative side: a cross-site
 * attacker can usually forge cookies in a session-fixation-style attack but
 * cannot read the csrf_token cookie due to same-origin policy, so they cannot
 * supply the matching header. Authed state-changing routes MUST reject the
 * request when this property fails.
 *
 * GET requests are NOT csrf-checked (they're idempotent + safe) so this file
 * does not assert against them.
 */

jest.mock('../utils/database');
jest.mock('../repos/queueRepo');
jest.mock('../utils/broadcast');
jest.mock('../utils/logEvent', () => ({ logEvent: jest.fn() }));
jest.mock('../routes/queueAutofill', () => ({
  serverAutofill: jest.fn().mockResolvedValue(undefined),
  autofillIfQueueEmpty: jest.fn(),
  attachAutofillRoutes: jest.fn((router) => router),
}));
jest.mock('../utils/paymentFulfill', () => ({ fulfillPaidRequest: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../utils/yoco', () => ({
  verifyCheckoutWithYoco: jest.fn().mockResolvedValue({ verified: false }),
  verifyYocoWebhookSignature: jest.fn().mockReturnValue(true),
}));
jest.mock('../utils/appleMusicToken', () => ({ getToken: jest.fn().mockResolvedValue('mock-token') }));

const request = require('supertest');
const jwt = require('jsonwebtoken');
const db = require('../utils/database');
const { app } = require('../app');

const JWT_SECRET = process.env.JWT_SECRET || 'speeldit-dev-secret-change-in-production';

function venueJwt(venueCode, csrf = 'csrf-real') {
  return jwt.sign({ venueCode, csrf, jti: `jti-${venueCode}-${csrf}` }, JWT_SECRET, { expiresIn: '7d' });
}

function ownerJwt(csrf = 'csrf-real') {
  return jwt.sign({ role: 'owner', csrf, jti: `jti-owner-${csrf}` }, JWT_SECRET, { expiresIn: '7d' });
}

beforeEach(() => {
  jest.resetAllMocks();
  db.getVenue.mockImplementation((code) => ({
    code,
    name: 'Test',
    owner: { email: 'o@bar.com' },
    settings: {},
  }));
  db.saveVenue.mockImplementation(() => {});
  db.getSubscription.mockReturnValue({ status: 'active' });
});

// ──────────────────────────────────────────────────────────────────────────────
// Venue routes
// ──────────────────────────────────────────────────────────────────────────────
describe('CSRF — venue PUT/POST/DELETE routes reject mismatched X-CSRF-Token', () => {
  test('PUT /api/venue/:code/theme returns 403 when X-CSRF-Token is missing', async () => {
    const res = await request(app)
      .put('/api/venue/TSTV01/theme')
      .set('Cookie', `auth_token=${venueJwt('TSTV01')}`)
      .send({ theme: 'dark' });
    expect(res.status).toBe(403);
    expect(db.saveVenue).not.toHaveBeenCalled();
  });

  test('PUT /api/venue/:code/theme returns 403 when X-CSRF-Token does not match JWT csrf claim', async () => {
    const res = await request(app)
      .put('/api/venue/TSTV01/theme')
      .set('Cookie', `auth_token=${venueJwt('TSTV01', 'csrf-real')}`)
      .set('X-CSRF-Token', 'csrf-attacker-guessed')
      .send({ theme: 'dark' });
    expect(res.status).toBe(403);
    expect(db.saveVenue).not.toHaveBeenCalled();
  });

  test('PUT /api/venue/:code/theme accepts matching X-CSRF-Token (positive control)', async () => {
    const res = await request(app)
      .put('/api/venue/TSTV01/theme')
      .set('Cookie', `auth_token=${venueJwt('TSTV01', 'csrf-real')}`)
      .set('X-CSRF-Token', 'csrf-real')
      .send({ theme: 'dark' });
    expect(res.status).toBe(200);
  });

  test('PUT /api/venue/:code/settings returns 403 with no X-CSRF-Token', async () => {
    const res = await request(app)
      .put('/api/venue/TSTV01/settings')
      .set('Cookie', `auth_token=${venueJwt('TSTV01')}`)
      .send({ maxSongsPerUser: 5 });
    expect(res.status).toBe(403);
  });

  test('POST /api/venue/:code/ban-artist returns 403 with mismatched X-CSRF-Token', async () => {
    const res = await request(app)
      .post('/api/venue/TSTV01/ban-artist')
      .set('Cookie', `auth_token=${venueJwt('TSTV01', 'csrf-real')}`)
      .set('X-CSRF-Token', 'wrong')
      .send({ artist: 'Some Artist' });
    expect(res.status).toBe(403);
  });

  test('POST /api/venue/:code/playlists returns 403 without X-CSRF-Token', async () => {
    const res = await request(app)
      .post('/api/venue/TSTV01/playlists')
      .set('Cookie', `auth_token=${venueJwt('TSTV01')}`)
      .send({ name: 'My Playlist' });
    expect(res.status).toBe(403);
  });

  test('DELETE /api/venue/:code/playlists/:id returns 403 without X-CSRF-Token', async () => {
    const res = await request(app)
      .delete('/api/venue/TSTV01/playlists/pl_123')
      .set('Cookie', `auth_token=${venueJwt('TSTV01')}`);
    expect(res.status).toBe(403);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Owner routes
// ──────────────────────────────────────────────────────────────────────────────
describe('CSRF — owner state-changing routes reject mismatched X-CSRF-Token', () => {
  test('POST /api/payouts/generate returns 403 without X-CSRF-Token', async () => {
    const res = await request(app)
      .post('/api/payouts/generate')
      .set('Cookie', `auth_token=${ownerJwt()}`)
      .send({ year: 2026, month: 4 });
    expect(res.status).toBe(403);
  });

  test('PUT /api/payouts/:id/status returns 403 with mismatched X-CSRF-Token', async () => {
    db.getPayoutById.mockReturnValue({ id: 'po_x', venue_code: 'TSTV01', status: 'pending' });
    const res = await request(app)
      .put('/api/payouts/po_x/status')
      .set('Cookie', `auth_token=${ownerJwt('csrf-real')}`)
      .set('X-CSRF-Token', 'wrong')
      .send({ status: 'paid' });
    expect(res.status).toBe(403);
    expect(db.updatePayoutStatus).not.toHaveBeenCalled();
  });

  test('POST /api/payouts/mark-all-paid returns 403 without X-CSRF-Token', async () => {
    const res = await request(app)
      .post('/api/payouts/mark-all-paid')
      .set('Cookie', `auth_token=${ownerJwt()}`)
      .send({ year: 2026, month: 4 });
    expect(res.status).toBe(403);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Safe methods are NOT CSRF-checked
// ──────────────────────────────────────────────────────────────────────────────
describe('CSRF — GETs are NOT subject to the check (safe methods)', () => {
  test('GET /api/venue/:code succeeds without X-CSRF-Token', async () => {
    db.getVenue.mockReturnValue({ code: 'TSTV01', name: 'Bar', settings: {}, playlists: [] });
    const res = await request(app)
      .get('/api/venue/TSTV01')
      .set('Cookie', `auth_token=${venueJwt('TSTV01')}`);
    expect(res.status).toBe(200);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Public (unauthed) routes do NOT need CSRF — they have no session
// ──────────────────────────────────────────────────────────────────────────────
describe('CSRF — public routes (no auth required) do not require X-CSRF-Token', () => {
  test('POST /api/queue/:code/vote does not require X-CSRF-Token (patron-facing, throttle-protected)', async () => {
    // Patron voting is throttle-protected, not CSRF-protected — patrons have no JWT.
    // We assert here that the absence of the CSRF header does not block them.
    db.getVenue.mockReturnValue({ code: 'TSTV01', settings: {} });
    const queueRepo = require('../repos/queueRepo');
    queueRepo.update.mockImplementation(async (_venueCode, fn) => {
      fn({ nowPlaying: null, upcoming: [{ id: 'song_1', votes: 0 }] });
      return { nowPlaying: null, upcoming: [{ id: 'song_1', votes: 1 }] };
    });
    db.getVote.mockReturnValue(undefined);
    db.setVote.mockImplementation(() => {});
    db.recordAnalyticsEvent.mockImplementation(() => {});

    const res = await request(app)
      .post('/api/queue/TSTV01/vote')
      .send({ songId: 'song_1', voteValue: 1, deviceId: 'device_abc' });
    // 200 or 404 — but NEVER 403 due to missing CSRF header
    expect(res.status).not.toBe(403);
  });
});
