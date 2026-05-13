/**
 * @jest-environment node
 *
 * Logout token revocation — proves that a JWT whose jti has been added to the
 * blacklist via POST /api/auth/logout is rejected by downstream auth middleware,
 * even though the JWT itself is still cryptographically valid and unexpired.
 *
 * Without this guarantee, a logged-out token continues to act as a bearer
 * credential for its full 7-day lifetime — a real concern on shared/public
 * devices. The blacklist is the only thing standing between "logout" and
 * "logout (but the cookie still works)."
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
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../utils/database');
const { app } = require('../app');

const JWT_SECRET = process.env.JWT_SECRET || 'speeldit-dev-secret-change-in-production';
const TEST_PASSWORD = 'correct-horse-battery-staple';
let TEST_HASH;

beforeAll(async () => {
  TEST_HASH = await bcrypt.hash(TEST_PASSWORD, 10);
}, 30_000);

beforeEach(() => {
  jest.resetAllMocks();
});

function stubVenue(code = 'LOGOUT', email = 'owner@bar.com') {
  const venue = {
    code,
    name: 'Test Bar',
    owner: { email, passwordHash: TEST_HASH },
    settings: {},
  };
  db.getVenueByOwnerEmail.mockReturnValue(venue);
  db.getVenue.mockReturnValue(venue);
  return venue;
}

function extractCookies(res) {
  const cookies = res.headers['set-cookie'] || [];
  const auth = cookies.find((c) => c.startsWith('auth_token='));
  const csrf = cookies.find((c) => c.startsWith('csrf_token='));
  return {
    authValue: auth?.split('=')[1].split(';')[0],
    csrfValue: csrf?.split('=')[1].split(';')[0],
  };
}

describe('Logout revokes the JWT', () => {
  test('valid pre-logout token can access /api/auth/me', async () => {
    stubVenue();
    const login = await request(app)
      .post('/api/auth/login')
      .send({ email: 'owner@bar.com', password: TEST_PASSWORD });
    expect(login.status).toBe(200);

    const { authValue } = extractCookies(login);
    expect(authValue).toBeTruthy();

    const me = await request(app)
      .get('/api/auth/me')
      .set('Cookie', `auth_token=${authValue}`);
    expect(me.status).toBe(200);
    expect(me.body.role).toBe('venue');
  });

  test('after POST /api/auth/logout the same token returns 401 from /api/auth/me', async () => {
    stubVenue();
    const login = await request(app)
      .post('/api/auth/login')
      .send({ email: 'owner@bar.com', password: TEST_PASSWORD });
    const { authValue, csrfValue } = extractCookies(login);

    // Logout — adds the JWT's jti to the in-memory blacklist
    const logoutRes = await request(app)
      .post('/api/auth/logout')
      .set('Cookie', `auth_token=${authValue}; csrf_token=${csrfValue}`)
      .set('X-CSRF-Token', csrfValue);
    expect(logoutRes.status).toBe(200);

    // Replay the same cookie — must be rejected because jti is now revoked
    const replayMe = await request(app)
      .get('/api/auth/me')
      .set('Cookie', `auth_token=${authValue}`);
    expect(replayMe.status).toBe(401);
    expect(replayMe.body.error || '').toMatch(/revoked|invalid|not authenticated/i);
  });

  test('after logout, the same token cannot access an authed venue route', async () => {
    stubVenue('LGOUT2');
    const login = await request(app)
      .post('/api/auth/login')
      .send({ email: 'owner@bar.com', password: TEST_PASSWORD });
    const { authValue, csrfValue } = extractCookies(login);

    await request(app)
      .post('/api/auth/logout')
      .set('Cookie', `auth_token=${authValue}; csrf_token=${csrfValue}`)
      .set('X-CSRF-Token', csrfValue);

    // Try a GET on /api/venue/:code — needs auth, hits authMiddleware
    const venueRes = await request(app)
      .get('/api/venue/LGOUT2')
      .set('Cookie', `auth_token=${authValue}`);
    expect(venueRes.status).toBe(401);
  });

  test('logout endpoint clears cookies even when given an already-invalid token', async () => {
    // Defensive: logout should always succeed and clear cookies, regardless
    // of whether the incoming token verifies. Prevents stuck-logged-in state.
    const res = await request(app)
      .post('/api/auth/logout')
      .set('Cookie', 'auth_token=garbage; csrf_token=anything')
      .set('X-CSRF-Token', 'anything');
    expect(res.status).toBe(200);
    const cookies = res.headers['set-cookie'] || [];
    expect(cookies.some((c) => c.startsWith('auth_token=') && /Max-Age=0/i.test(c))).toBe(true);
    expect(cookies.some((c) => c.startsWith('csrf_token=') && /Max-Age=0/i.test(c))).toBe(true);
  });

  test('two different logins generate distinct jtis; revoking one does not affect the other', async () => {
    stubVenue();

    const loginA = await request(app)
      .post('/api/auth/login')
      .send({ email: 'owner@bar.com', password: TEST_PASSWORD });
    const a = extractCookies(loginA);

    const loginB = await request(app)
      .post('/api/auth/login')
      .send({ email: 'owner@bar.com', password: TEST_PASSWORD });
    const b = extractCookies(loginB);

    expect(jwt.decode(a.authValue).jti).not.toBe(jwt.decode(b.authValue).jti);

    // Revoke A
    await request(app)
      .post('/api/auth/logout')
      .set('Cookie', `auth_token=${a.authValue}; csrf_token=${a.csrfValue}`)
      .set('X-CSRF-Token', a.csrfValue);

    // B must still work
    const meB = await request(app)
      .get('/api/auth/me')
      .set('Cookie', `auth_token=${b.authValue}`);
    expect(meB.status).toBe(200);
  });
});
