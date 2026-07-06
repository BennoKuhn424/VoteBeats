/**
 * Email-verification enforcement, tested against the REAL SQLite layer.
 *
 * Regression test for a bug the mocked-database auth tests could not see:
 * `venueToRow`/`rowToVenue` used to drop `owner.emailVerified` on the DB
 * round-trip, so the login block (`emailVerified === false`) never fired and
 * unverified accounts could log in. These tests use the real database module
 * (temp DATA_DIR) so the persistence path itself is exercised.
 *
 * Only the email transport is mocked — we capture the verify token instead of
 * sending mail, and toggle isEmailConfigured() to cover the no-email deploys
 * where registration must auto-verify rather than lock the account out.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'speeldit-verify-'));
const ORIGINAL_DATA_DIR = process.env.DATA_DIR;
process.env.DATA_DIR = tmpDir;

jest.mock('../utils/email', () => ({
  isEmailConfigured: jest.fn(() => true),
  sendVerificationEmail: jest.fn(async () => {}),
  sendPasswordResetEmail: jest.fn(async () => {}),
}));

const request = require('supertest');
const bcrypt = require('bcryptjs');
const emailMock = require('../utils/email');
const db = require('../utils/database');
const sqlite = require('../utils/sqlite');
const { app } = require('../app');

afterAll(() => {
  sqlite.closeForTest();
  if (ORIGINAL_DATA_DIR === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = ORIGINAL_DATA_DIR;
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
});

beforeEach(() => {
  emailMock.isEmailConfigured.mockReturnValue(true);
  emailMock.sendVerificationEmail.mockClear();
});

// ── Persistence round-trip (the layer the old bug lived in) ──────────────────
describe('emailVerified survives the SQLite round-trip', () => {
  test('false → saved → read back as false', () => {
    db.saveVenue('RTVF01', {
      code: 'RTVF01',
      name: 'Round Trip Bar',
      owner: { email: 'rt-false@test.com', passwordHash: 'x', emailVerified: false },
      settings: {},
    });
    expect(db.getVenue('RTVF01').owner.emailVerified).toBe(false);
  });

  test('true → saved → read back as true', () => {
    db.saveVenue('RTVT01', {
      code: 'RTVT01',
      name: 'Round Trip Bar',
      owner: { email: 'rt-true@test.com', passwordHash: 'x', emailVerified: true },
      settings: {},
    });
    expect(db.getVenue('RTVT01').owner.emailVerified).toBe(true);
  });

  test('legacy row (NULL column) → emailVerified absent, not false', () => {
    sqlite.prepare(`
      INSERT INTO venues (code, name, owner_email, owner_password_hash, settings, playlists, created_at)
      VALUES ('LGCY01', 'Legacy Bar', 'legacy@test.com', 'x', '{}', '[]', ?)
    `).run(new Date().toISOString());
    const venue = db.getVenue('LGCY01');
    expect(venue.owner.emailVerified).toBeUndefined();
    expect('emailVerified' in venue.owner).toBe(false);
  });
});

// ── Full HTTP flow: register → blocked login → verify → login ────────────────
describe('register → verify → login (email configured)', () => {
  const EMAIL = 'flow@test.com';
  const PASSWORD = 'super-secret-99';
  let venueCode;
  let verifyToken;

  test('registration requires verification', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: EMAIL, password: PASSWORD, venueName: 'Flow Bar' });
    expect(res.status).toBe(201);
    expect(res.body.requiresVerification).toBe(true);
    venueCode = res.body.venueCode;
    expect(emailMock.sendVerificationEmail).toHaveBeenCalledTimes(1);
    // Grab the token now — beforeEach clears the mock between tests.
    verifyToken = emailMock.sendVerificationEmail.mock.calls[0][1];
    expect(typeof verifyToken).toBe('string');
  });

  test('login is blocked before verification', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: EMAIL, password: PASSWORD });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('AUTH_EMAIL_NOT_VERIFIED');
  });

  test('verify-email flips the flag and login succeeds', async () => {
    const token = verifyToken;
    const verifyRes = await request(app).get(`/api/auth/verify-email?token=${token}`);
    expect(verifyRes.status).toBe(200);

    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ email: EMAIL, password: PASSWORD });
    expect(loginRes.status).toBe(200);
    expect(loginRes.body.venueCode).toBe(venueCode);

    // Token is single-use
    const replay = await request(app).get(`/api/auth/verify-email?token=${token}`);
    expect(replay.status).toBe(400);
  });
});

// ── No outbound email configured: auto-verify instead of locking out ─────────
describe('register when email is NOT configured', () => {
  test('account is auto-verified and can log in immediately', async () => {
    emailMock.isEmailConfigured.mockReturnValue(false);

    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: 'noemail@test.com', password: 'super-secret-99', venueName: 'No Email Bar' });
    expect(res.status).toBe(201);
    expect(res.body.requiresVerification).toBe(false);
    expect(emailMock.sendVerificationEmail).not.toHaveBeenCalled();

    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ email: 'noemail@test.com', password: 'super-secret-99' });
    expect(loginRes.status).toBe(200);
    expect(loginRes.body.venueCode).toBe(res.body.venueCode);
  });
});

// ── Grandfathered legacy accounts are never blocked at login ─────────────────
describe('legacy account (pre-column, NULL email_verified)', () => {
  test('can still log in', async () => {
    const hash = await bcrypt.hash('legacy-pass-123', 10);
    sqlite.prepare(`
      INSERT INTO venues (code, name, owner_email, owner_password_hash, settings, playlists, created_at)
      VALUES ('LGCY02', 'Old Faithful', 'oldtimer@test.com', ?, '{}', '[]', ?)
    `).run(hash, new Date().toISOString());

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'oldtimer@test.com', password: 'legacy-pass-123' });
    expect(res.status).toBe(200);
    expect(res.body.venueCode).toBe('LGCY02');
  });
});
