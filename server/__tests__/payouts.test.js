/**
 * @jest-environment node
 *
 * Integration tests for /api/payouts.
 *
 * Covers:
 *   - owner-only routes reject unauthenticated requests
 *   - bank-details write validates SA bank-account format
 *   - venue routes require the caller's own venueCode
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

function makeVenueJwt(venueCode, csrf = 'csrf-abc') {
  return jwt.sign({ venueCode, csrf, jti: `jti-${venueCode}` }, JWT_SECRET, { expiresIn: '7d' });
}

beforeEach(() => {
  jest.resetAllMocks();
});

// ══════════════════════════════════════════════════════════════════════════════
// Owner-only routes — unauthenticated
// ══════════════════════════════════════════════════════════════════════════════
describe('Owner payout routes reject unauthenticated requests', () => {
  test('POST /api/payouts/generate without auth → 401', async () => {
    const res = await request(app).post('/api/payouts/generate').send({ year: 2026, month: 3 });
    expect(res.status).toBe(401);
  });

  test('GET /api/payouts without auth → 401', async () => {
    const res = await request(app).get('/api/payouts');
    expect(res.status).toBe(401);
  });

  test('GET /api/payouts/summary without auth → 401', async () => {
    const res = await request(app).get('/api/payouts/summary');
    expect(res.status).toBe(401);
  });

  test('POST /api/payouts/mark-all-paid without auth → 401', async () => {
    const res = await request(app)
      .post('/api/payouts/mark-all-paid')
      .send({ year: 2026, month: 3 });
    expect(res.status).toBe(401);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Venue bank-details — validation
// ══════════════════════════════════════════════════════════════════════════════
describe('PUT /api/payouts/venue/:venueCode/bank-details — validation', () => {
  const venueCode = 'TSTV01';
  const venue = { code: venueCode, name: 'Test Bar', settings: {} };

  function setupVenue() {
    db.getVenue.mockReturnValue(venue);
    db.saveVenue.mockImplementation(() => {});
  }

  function authed() {
    const token = makeVenueJwt(venueCode);
    return request(app)
      .put(`/api/payouts/venue/${venueCode}/bank-details`)
      .set('Cookie', `auth_token=${token}`)
      .set('X-CSRF-Token', 'csrf-abc');
  }

  test('rejects missing required fields', async () => {
    setupVenue();
    const res = await authed().send({ bankName: 'FNB' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/required/i);
  });

  test('rejects account number with letters', async () => {
    setupVenue();
    const res = await authed().send({
      bankName: 'FNB',
      accountHolder: 'John Doe',
      accountNumber: 'abc123',
      branchCode: '250655',
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/account number/i);
  });

  test('rejects account number shorter than 7 digits', async () => {
    setupVenue();
    const res = await authed().send({
      bankName: 'FNB',
      accountHolder: 'John Doe',
      accountNumber: '123456',
      branchCode: '250655',
    });
    expect(res.status).toBe(400);
  });

  test('rejects account number longer than 16 digits', async () => {
    setupVenue();
    const res = await authed().send({
      bankName: 'FNB',
      accountHolder: 'John Doe',
      accountNumber: '12345678901234567',
      branchCode: '250655',
    });
    expect(res.status).toBe(400);
  });

  test('rejects branch code with letters', async () => {
    setupVenue();
    const res = await authed().send({
      bankName: 'FNB',
      accountHolder: 'John Doe',
      accountNumber: '1234567890',
      branchCode: 'ABCDEF',
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/branch code/i);
  });

  test('accepts valid SA bank details and strips spaces', async () => {
    setupVenue();
    const res = await authed().send({
      bankName: 'FNB',
      accountHolder: 'John Doe',
      accountNumber: '12345 6789',
      branchCode: '250 655',
      accountType: 'savings',
    });
    expect(res.status).toBe(200);
    // Spaces should be stripped before storage
    expect(db.saveVenue).toHaveBeenCalledWith(
      venueCode,
      expect.objectContaining({
        settings: expect.objectContaining({
          bankDetails: expect.objectContaining({
            accountNumber: '123456789',
            branchCode: '250655',
            accountType: 'savings',
          }),
        }),
      })
    );
  });

  test('defaults accountType to cheque when omitted', async () => {
    setupVenue();
    const res = await authed().send({
      bankName: 'FNB',
      accountHolder: 'John Doe',
      accountNumber: '1234567890',
      branchCode: '250655',
    });
    expect(res.status).toBe(200);
    expect(db.saveVenue).toHaveBeenCalledWith(
      venueCode,
      expect.objectContaining({
        settings: expect.objectContaining({
          bankDetails: expect.objectContaining({ accountType: 'cheque' }),
        }),
      })
    );
  });

  test('rejects cross-venue access (authed as A, writing to B)', async () => {
    // Authed as OTHER1 but targeting TSTV01 path — the route must reject.
    db.getVenue.mockImplementation((code) =>
      code === 'OTHER1' ? { code: 'OTHER1', name: 'Other', settings: {} } : venue
    );
    const otherToken = makeVenueJwt('OTHER1');
    const res = await request(app)
      .put(`/api/payouts/venue/${venueCode}/bank-details`)
      .set('Cookie', `auth_token=${otherToken}`)
      .set('X-CSRF-Token', 'csrf-abc')
      .send({
        bankName: 'FNB',
        accountHolder: 'Attacker',
        accountNumber: '1234567890',
        branchCode: '250655',
      });
    expect(res.status).toBe(403);
    expect(db.saveVenue).not.toHaveBeenCalled();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Venue bank-details — read
// ══════════════════════════════════════════════════════════════════════════════
describe('GET /api/payouts/venue/:venueCode/bank-details', () => {
  const venueCode = 'TSTV02';

  test('returns null when no bank details saved yet', async () => {
    db.getVenue.mockReturnValue({ code: venueCode, name: 'Bar', settings: {} });
    const token = makeVenueJwt(venueCode);
    const res = await request(app)
      .get(`/api/payouts/venue/${venueCode}/bank-details`)
      .set('Cookie', `auth_token=${token}`);
    expect(res.status).toBe(200);
    expect(res.body.bankDetails).toBeNull();
  });

  test('returns saved bank details', async () => {
    db.getVenue.mockReturnValue({
      code: venueCode,
      name: 'Bar',
      settings: {
        bankDetails: {
          bankName: 'FNB',
          accountHolder: 'John',
          accountNumber: '1234567890',
          branchCode: '250655',
          accountType: 'cheque',
        },
      },
    });
    const token = makeVenueJwt(venueCode);
    const res = await request(app)
      .get(`/api/payouts/venue/${venueCode}/bank-details`)
      .set('Cookie', `auth_token=${token}`);
    expect(res.status).toBe(200);
    expect(res.body.bankDetails.bankName).toBe('FNB');
  });

  test('without auth → 401', async () => {
    const res = await request(app).get(`/api/payouts/venue/${venueCode}/bank-details`);
    expect(res.status).toBe(401);
  });
});
