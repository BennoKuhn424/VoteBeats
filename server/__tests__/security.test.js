/**
 * Security-focused tests: venue code validation, JWT integrity, cookie flags,
 * CSRF enforcement, and request body limits.
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
const queueRepo = require('../repos/queueRepo');
const { app } = require('../app');

const JWT_SECRET = process.env.JWT_SECRET || 'speeldit-dev-secret-change-in-production';
const TEST_PASSWORD = 'correct-horse-battery-staple';
let TEST_HASH;

beforeAll(async () => {
  TEST_HASH = await bcrypt.hash(TEST_PASSWORD, 10);
}, 30_000);

beforeEach(() => {
  jest.resetAllMocks();
  db.getVotesForDevice.mockReturnValue({});
  db.getPlayerVolumeReport.mockReturnValue(null);
  db.checkAndSetThrottle.mockReturnValue(true);
  db.recordAnalyticsEvent.mockImplementation(() => {});
  queueRepo.get.mockReturnValue({ nowPlaying: null, upcoming: [] });
});

// ══════════════════════════════════════════════════════════════════════════════
// Venue code format validation
// ══════════════════════════════════════════════════════════════════════════════
describe('Venue code format validation', () => {
  test('rejects lowercase venue codes', async () => {
    const res = await request(app).get('/api/queue/abcdef');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalid venue code/i);
  });

  test('rejects venue codes shorter than 6 chars', async () => {
    const res = await request(app).get('/api/queue/ABC');
    expect(res.status).toBe(400);
  });

  test('rejects venue codes longer than 6 chars', async () => {
    const res = await request(app).get('/api/queue/ABCDEFG');
    expect(res.status).toBe(400);
  });

  test('rejects venue codes with special characters', async () => {
    const res = await request(app).get('/api/queue/ABC!@#');
    expect(res.status).toBe(400);
  });

  test('rejects venue codes with path traversal attempt', async () => {
    const res = await request(app).get('/api/queue/../../etc');
    // Express route won't match, so it's a 404 or handled differently
    expect(res.status).not.toBe(200);
  });

  test('accepts valid 6-char uppercase alphanumeric venue code', async () => {
    db.getVenue.mockReturnValue({ code: 'TSTV01', name: 'Test', settings: {} });
    const res = await request(app).get('/api/queue/TSTV99');
    // Should pass validation (may be 200 or 404 based on venue existence)
    expect(res.status).not.toBe(400);
  });

  test('accepts venue codes with digits 0 and 1', async () => {
    db.getVenue.mockReturnValue({ code: 'ABC010', name: 'Test', settings: {} });
    const res = await request(app).get('/api/queue/ABC010');
    expect(res.status).not.toBe(400);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// JWT token integrity
// ══════════════════════════════════════════════════════════════════════════════
describe('JWT token integrity', () => {
  function stubVenueForLogin(email = 'owner@bar.com') {
    const venue = {
      code: 'TSTV22',
      name: 'Test Bar',
      location: 'Cape Town',
      owner: { email, passwordHash: TEST_HASH },
      settings: {},
    };
    db.getAllVenues.mockReturnValue({ TSTV22: venue });
    db.getVenueByOwnerEmail.mockReturnValue(venue);
    db.getVenue.mockReturnValue(venue);
    db.saveVenue.mockImplementation(() => {});
    return venue;
  }

  test('venue login JWT includes jti claim', async () => {
    stubVenueForLogin();
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'owner@bar.com', password: TEST_PASSWORD });
    expect(res.status).toBe(200);

    const cookies = res.headers['set-cookie'];
    const authCookie = cookies.find(c => c.startsWith('auth_token='));
    const tokenValue = authCookie.split('=')[1].split(';')[0];
    const payload = jwt.decode(tokenValue);

    expect(payload.jti).toBeDefined();
    expect(typeof payload.jti).toBe('string');
    expect(payload.jti.length).toBeGreaterThan(0);
  });

  test('register does not auto-login (requires email verification)', async () => {
    db.getAllVenues.mockReturnValue({});
    db.getVenueByOwnerEmail.mockReturnValue(null);
    db.getVenue.mockReturnValue(null);
    db.saveVenue.mockImplementation(() => {});

    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: 'new@bar.com', password: 'secret12345', venueName: 'My Bar' });
    expect(res.status).toBe(201);
    expect(res.body.requiresVerification).toBe(true);

    // No auth cookie should be set — user must verify email first
    const cookies = res.headers['set-cookie'] || [];
    expect(cookies.some(c => c.startsWith('auth_token='))).toBe(false);
  });

  test('each login generates a unique jti', async () => {
    stubVenueForLogin();
    const res1 = await request(app)
      .post('/api/auth/login')
      .send({ email: 'owner@bar.com', password: TEST_PASSWORD });
    const res2 = await request(app)
      .post('/api/auth/login')
      .send({ email: 'owner@bar.com', password: TEST_PASSWORD });

    const getJti = (res) => {
      const cookies = res.headers['set-cookie'];
      const authCookie = cookies.find(c => c.startsWith('auth_token='));
      const tokenValue = authCookie.split('=')[1].split(';')[0];
      return jwt.decode(tokenValue).jti;
    };

    expect(getJti(res1)).not.toBe(getJti(res2));
  });

  test('JWT includes csrf claim that matches csrf_token cookie', async () => {
    stubVenueForLogin();
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'owner@bar.com', password: TEST_PASSWORD });

    const cookies = res.headers['set-cookie'];
    const authCookie = cookies.find(c => c.startsWith('auth_token='));
    const csrfCookie = cookies.find(c => c.startsWith('csrf_token='));

    const tokenValue = authCookie.split('=')[1].split(';')[0];
    const csrfValue = csrfCookie.split('=')[1].split(';')[0];
    const payload = jwt.decode(tokenValue);

    expect(payload.csrf).toBe(csrfValue);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Cookie security flags
// ══════════════════════════════════════════════════════════════════════════════
describe('Cookie security flags', () => {
  function stubVenueForLogin() {
    const venue = {
      code: 'TSTV33',
      name: 'Test Bar',
      owner: { email: 'owner@bar.com', passwordHash: TEST_HASH },
      settings: {},
    };
    db.getAllVenues.mockReturnValue({ TSTV33: venue });
    db.getVenueByOwnerEmail.mockReturnValue(venue);
    db.getVenue.mockReturnValue(venue);
    return venue;
  }

  test('auth_token cookie is httpOnly', async () => {
    stubVenueForLogin();
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'owner@bar.com', password: TEST_PASSWORD });

    const cookies = res.headers['set-cookie'];
    const authCookie = cookies.find(c => c.startsWith('auth_token='));
    expect(authCookie).toMatch(/HttpOnly/i);
  });

  test('csrf_token cookie is NOT httpOnly (readable by JS)', async () => {
    stubVenueForLogin();
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'owner@bar.com', password: TEST_PASSWORD });

    const cookies = res.headers['set-cookie'];
    const csrfCookie = cookies.find(c => c.startsWith('csrf_token='));
    expect(csrfCookie).not.toMatch(/HttpOnly/i);
  });

  test('cookies have SameSite=Lax', async () => {
    stubVenueForLogin();
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'owner@bar.com', password: TEST_PASSWORD });

    const cookies = res.headers['set-cookie'];
    const authCookie = cookies.find(c => c.startsWith('auth_token='));
    expect(authCookie).toMatch(/SameSite=Lax/i);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Request body size limits
// ══════════════════════════════════════════════════════════════════════════════
describe('Request body size limits', () => {
  test('rejects payloads larger than 50kb', async () => {
    const largeBody = { data: 'x'.repeat(60_000) };
    const res = await request(app)
      .post('/api/auth/login')
      .send(largeBody);
    expect(res.status).toBe(413);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Auth-protected routes reject unauthenticated requests
// ══════════════════════════════════════════════════════════════════════════════
describe('Auth-protected routes', () => {
  test('GET /api/venue/:venueCode returns 401 without auth cookie', async () => {
    db.getVenue.mockReturnValue({ code: 'TSTV44', name: 'Bar', settings: {} });
    const res = await request(app).get('/api/venue/TSTV44');
    expect(res.status).toBe(401);
  });

  test('venue route rejects expired JWT', async () => {
    db.getVenue.mockReturnValue({ code: 'TSTV44', name: 'Bar', settings: {} });
    const expiredToken = jwt.sign(
      { venueCode: 'TSTV44', csrf: 'test', jti: 'test-jti' },
      JWT_SECRET,
      { expiresIn: '-1s' }
    );
    const res = await request(app)
      .get('/api/venue/TSTV44')
      .set('Cookie', `auth_token=${expiredToken}`);
    expect(res.status).toBe(401);
  });

  test('venue route rejects JWT signed with wrong secret', async () => {
    db.getVenue.mockReturnValue({ code: 'TSTV44', name: 'Bar', settings: {} });
    const badToken = jwt.sign(
      { venueCode: 'TSTV44', csrf: 'test', jti: 'test-jti' },
      'wrong-secret',
      { expiresIn: '7d' }
    );
    const res = await request(app)
      .get('/api/venue/TSTV44')
      .set('Cookie', `auth_token=${badToken}`);
    expect(res.status).toBe(401);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Input sanitization edge cases
// ══════════════════════════════════════════════════════════════════════════════
describe('Input sanitization', () => {
  test('rejects song request with extremely long appleId', async () => {
    db.getVenue.mockReturnValue({ code: 'TSTV55', name: 'Bar', settings: { maxSongsPerUser: 3 } });
    const res = await request(app)
      .post('/api/queue/TSTV55/request')
      .send({
        song: { appleId: 'x'.repeat(200), title: 'Test', artist: 'Test' },
        deviceId: 'device123',
      });
    expect(res.status).toBe(400);
  });

  test('rejects vote with empty songId', async () => {
    db.getVenue.mockReturnValue({ code: 'TSTV55', name: 'Bar', settings: {} });
    const res = await request(app)
      .post('/api/queue/TSTV55/vote')
      .send({ songId: '', voteValue: 1, deviceId: 'device123' });
    expect(res.status).toBe(400);
  });

  test('rejects registration with password shorter than 8 chars', async () => {
    db.getAllVenues.mockReturnValue({});
    db.getVenueByOwnerEmail.mockReturnValue(null);
    db.getVenue.mockReturnValue(null);
    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: 'new@bar.com', password: 'short', venueName: 'Bar' });
    expect(res.status).toBe(400);
  });

  test('rejects registration with email longer than 254 chars', async () => {
    db.getAllVenues.mockReturnValue({});
    db.getVenueByOwnerEmail.mockReturnValue(null);
    db.getVenue.mockReturnValue(null);
    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: 'a'.repeat(250) + '@b.com', password: 'secret12345', venueName: 'Bar' });
    expect(res.status).toBe(400);
  });
});
