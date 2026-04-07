/**
 * HTTP-level tests for POST /api/auth/register and POST /api/auth/login.
 *
 * The database module is mocked so no JSON files are written to disk.
 * bcryptjs is NOT mocked so password-hashing semantics are verified for real.
 */

jest.mock('../utils/database');

const request = require('supertest');
const bcrypt = require('bcryptjs');
const db = require('../utils/database');
const { app } = require('../app');

// ── Shared test hash (generated once for the whole suite) ─────────────────────
const TEST_PASSWORD = 'correct-horse-battery-staple';
let TEST_HASH;

beforeAll(async () => {
  // bcrypt with cost 10 is used in production; keep it consistent in tests.
  TEST_HASH = await bcrypt.hash(TEST_PASSWORD, 10);
}, 30_000);

// ── Helpers ───────────────────────────────────────────────────────────────────
function stubEmptyVenues() {
  db.getAllVenues.mockReturnValue({});
  db.getVenue.mockReturnValue(null);
  db.saveVenue.mockImplementation(() => {});
}

function stubExistingVenue(email = 'owner@bar.com') {
  const venue = {
    code: 'TSTV01',
    name: 'Test Bar',
    location: 'Cape Town',
    owner: { email, passwordHash: TEST_HASH },
    settings: {},
  };
  db.getAllVenues.mockReturnValue({ TSTV01: venue });
  db.getVenue.mockReturnValue(venue);
  return venue;
}

beforeEach(() => {
  jest.resetAllMocks();
});

// ══════════════════════════════════════════════════════════════════════════════
// POST /api/auth/register
// ══════════════════════════════════════════════════════════════════════════════
describe('POST /api/auth/register', () => {
  test('400 when email is missing', async () => {
    stubEmptyVenues();
    const res = await request(app)
      .post('/api/auth/register')
      .send({ password: 'secret123', venueName: 'My Bar' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/email/i);
  });

  test('400 when password is missing', async () => {
    stubEmptyVenues();
    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: 'new@bar.com', venueName: 'My Bar' });
    expect(res.status).toBe(400);
  });

  test('400 when venueName is missing', async () => {
    stubEmptyVenues();
    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: 'new@bar.com', password: 'secret123' });
    expect(res.status).toBe(400);
  });

  test('400 when email is already registered (case-insensitive)', async () => {
    stubExistingVenue('owner@bar.com');
    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: 'OWNER@BAR.COM', password: 'secret123', venueName: 'My Bar' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/already registered/i);
  });

  test('400 when using the reserved owner email', async () => {
    stubEmptyVenues();
    const prev = process.env.OWNER_EMAIL;
    process.env.OWNER_EMAIL = 'platform@owner.com';
    try {
      const res = await request(app)
        .post('/api/auth/register')
        .send({ email: 'platform@owner.com', password: 'secret123', venueName: 'My Bar' });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/not available/i);
    } finally {
      process.env.OWNER_EMAIL = prev;
    }
  });

  test('201 with token, venueCode, and venue on success', async () => {
    stubEmptyVenues();
    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: 'new@bar.com', password: 'secret123', venueName: 'Grand Venue', location: 'JHB' });
    expect(res.status).toBe(201);
    expect(typeof res.body.token).toBe('string');
    expect(res.body.venueCode).toHaveLength(6);
    expect(res.body.venue.name).toBe('Grand Venue');
    expect(res.body.venue.location).toBe('JHB');
    expect(db.saveVenue).toHaveBeenCalledTimes(1);
  });

  test('token payload contains the new venueCode', async () => {
    stubEmptyVenues();
    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: 'new@bar.com', password: 'secret123', venueName: 'Bar' });
    expect(res.status).toBe(201);
    // Decode (no verify) to inspect payload
    const jwt = require('jsonwebtoken');
    const payload = jwt.decode(res.body.token);
    expect(payload.venueCode).toBe(res.body.venueCode);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// POST /api/auth/login
// ══════════════════════════════════════════════════════════════════════════════
describe('POST /api/auth/login', () => {
  test('400 when email is missing', async () => {
    const res = await request(app).post('/api/auth/login').send({ password: TEST_PASSWORD });
    expect(res.status).toBe(400);
  });

  test('400 when password is missing', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: 'x@bar.com' });
    expect(res.status).toBe(400);
  });

  test('401 for unknown email', async () => {
    db.getAllVenues.mockReturnValue({});
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'nobody@bar.com', password: TEST_PASSWORD });
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/invalid email or password/i);
  });

  test('401 for correct email but wrong password', async () => {
    stubExistingVenue();
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'owner@bar.com', password: 'wrong-password' });
    expect(res.status).toBe(401);
  });

  test('200 with token and venueCode on correct credentials', async () => {
    stubExistingVenue();
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'owner@bar.com', password: TEST_PASSWORD });
    expect(res.status).toBe(200);
    expect(typeof res.body.token).toBe('string');
    expect(res.body.venueCode).toBe('TSTV01');
  });

  test('login is case-insensitive for email', async () => {
    stubExistingVenue('owner@bar.com');
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'OWNER@BAR.COM', password: TEST_PASSWORD });
    expect(res.status).toBe(200);
  });

  test('owner login returns role:owner token when OWNER_EMAIL matches', async () => {
    const ownerEmail = 'platform@owner.com';
    const ownerHash = await bcrypt.hash('owner-secret', 10);
    const prev = { email: process.env.OWNER_EMAIL, hash: process.env.OWNER_PASSWORD_HASH };
    process.env.OWNER_EMAIL = ownerEmail;
    process.env.OWNER_PASSWORD_HASH = ownerHash;
    db.getAllVenues.mockReturnValue({});
    try {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: ownerEmail, password: 'owner-secret' });
      expect(res.status).toBe(200);
      expect(res.body.role).toBe('owner');
      const jwt = require('jsonwebtoken');
      const payload = jwt.decode(res.body.token);
      expect(payload.role).toBe('owner');
    } finally {
      process.env.OWNER_EMAIL = prev.email;
      process.env.OWNER_PASSWORD_HASH = prev.hash;
    }
  }, 30_000);

  test('503 when OWNER_EMAIL is set but OWNER_PASSWORD_HASH is missing', async () => {
    const prev = { email: process.env.OWNER_EMAIL, hash: process.env.OWNER_PASSWORD_HASH };
    process.env.OWNER_EMAIL = 'platform@owner.com';
    delete process.env.OWNER_PASSWORD_HASH;
    try {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: 'platform@owner.com', password: 'any' });
      expect(res.status).toBe(503);
    } finally {
      process.env.OWNER_EMAIL = prev.email;
      if (prev.hash) process.env.OWNER_PASSWORD_HASH = prev.hash;
    }
  });
});
