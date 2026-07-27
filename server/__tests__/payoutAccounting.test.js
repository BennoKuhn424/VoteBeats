/**
 * @jest-environment node
 *
 * Accounting-integrity tests for /api/payouts.
 *
 * These cover the money-handling rules rather than auth/validation (see
 * payouts.test.js for those):
 *   - the audit log records the real amount, venue and proof reference
 *     (it reads camelCase off rowToPayout — snake_case silently yields
 *     `undefined`/0 and destroys the evidence trail)
 *   - a payout cannot be marked paid without proof of payment
 *   - outstanding balances accumulate across multiple unpaid months
 *   - reconciliation flags a payout row that disagrees with the raw payments
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

// Owner auth uses the same auth_token cookie + JWT_SECRET as venues, keyed off
// a role:'owner' claim (see middleware/ownerAuthMiddleware.js).
function ownerCookie() {
  return jwt.sign({ role: 'owner', jti: 'owner-jti-1', csrf: 'csrf-own' }, JWT_SECRET, {
    expiresIn: '1d',
  });
}

function ownerReq(method, path) {
  return request(app)[method](path)
    .set('Cookie', `auth_token=${ownerCookie()}`)
    .set('X-CSRF-Token', 'csrf-own');
}

function makeVenueJwt(venueCode, csrf = 'csrf-abc') {
  return jwt.sign({ venueCode, csrf, jti: `jti-${venueCode}` }, JWT_SECRET, { expiresIn: '7d' });
}

/** A payout as rowToPayout returns it — camelCase, no snake_case aliases. */
function payout(overrides = {}) {
  return {
    id: 'po_1',
    venueCode: 'VEN001',
    year: 2026,
    month: 6,
    grossCents: 5000,
    venueSharePercent: 70,
    venueAmountCents: 3500,
    platformAmountCents: 1500,
    grossRand: '50.00',
    venueAmountRand: '35.00',
    platformAmountRand: '15.00',
    status: 'pending',
    paidAt: null,
    notes: '',
    proofReference: null,
    proofRecordedAt: null,
    proofRecordedBy: null,
    createdAt: Date.now(),
    monthLabel: '2026-06',
    ...overrides,
  };
}

beforeEach(() => {
  jest.resetAllMocks();
});

// ══════════════════════════════════════════════════════════════════════════════
// Audit log must capture the real numbers
// ══════════════════════════════════════════════════════════════════════════════
describe('payout audit log records real values', () => {
  test('status change logs amount, venue and month (not undefined)', async () => {
    const p = payout();
    db.getPayoutById.mockReturnValue(p);
    db.updatePayoutStatus.mockImplementation(() => {});
    db.recordAuditEvent.mockImplementation(() => {});

    const res = await ownerReq('put', '/api/payouts/po_1/status').send({
      status: 'paid',
      proofReference: 'FNB-12345',
    });

    expect(res.status).toBe(200);
    expect(db.recordAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'payout.status-change',
        venueCode: 'VEN001',
        detail: expect.objectContaining({
          amountCents: 3500,
          monthLabel: '2026-06',
          proofReference: 'FNB-12345',
        }),
      })
    );
  });

  test('bulk mark-all-paid logs the true total, not 0', async () => {
    db.getAllPayoutsForMonth.mockReturnValue([
      payout({ id: 'po_1', venueAmountCents: 3500 }),
      payout({ id: 'po_2', venueAmountCents: 1500 }),
      payout({ id: 'po_3', venueAmountCents: 9999, status: 'paid' }), // already paid, skipped
    ]);
    db.updatePayoutStatus.mockImplementation(() => {});
    db.recordAuditEvent.mockImplementation(() => {});

    const res = await ownerReq('post', '/api/payouts/mark-all-paid').send({
      year: 2026,
      month: 6,
      proofReference: 'BULK-REF-1',
    });

    expect(res.status).toBe(200);
    expect(db.recordAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'payout.mark-all-paid',
        detail: expect.objectContaining({
          count: 2,
          totalCents: 5000, // 3500 + 1500, excluding the already-paid row
          proofReference: 'BULK-REF-1',
        }),
      })
    );
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Proof of payment is mandatory
// ══════════════════════════════════════════════════════════════════════════════
describe('proof of payment required before marking paid', () => {
  test('rejects paid without proofReference', async () => {
    db.getPayoutById.mockReturnValue(payout());

    const res = await ownerReq('put', '/api/payouts/po_1/status').send({ status: 'paid' });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('PROOF_REQUIRED');
    expect(db.updatePayoutStatus).not.toHaveBeenCalled();
  });

  test('rejects paid with whitespace-only proofReference', async () => {
    db.getPayoutById.mockReturnValue(payout());

    const res = await ownerReq('put', '/api/payouts/po_1/status').send({
      status: 'paid',
      proofReference: '   ',
    });

    expect(res.status).toBe(400);
    expect(db.updatePayoutStatus).not.toHaveBeenCalled();
  });

  test('allows failed without proof (no money moved)', async () => {
    db.getPayoutById.mockReturnValue(payout());
    db.updatePayoutStatus.mockImplementation(() => {});
    db.recordAuditEvent.mockImplementation(() => {});

    const res = await ownerReq('put', '/api/payouts/po_1/status').send({
      status: 'failed',
      notes: 'bank rejected',
    });

    expect(res.status).toBe(200);
    expect(db.updatePayoutStatus).toHaveBeenCalledWith('po_1', 'failed', 'bank rejected', undefined);
  });

  test('bulk mark-all-paid rejects missing proofReference', async () => {
    const res = await ownerReq('post', '/api/payouts/mark-all-paid').send({ year: 2026, month: 6 });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('PROOF_REQUIRED');
    expect(db.updatePayoutStatus).not.toHaveBeenCalled();
  });

  test('proof reference is forwarded to the DB layer', async () => {
    db.getPayoutById.mockReturnValue(payout());
    db.updatePayoutStatus.mockImplementation(() => {});
    db.recordAuditEvent.mockImplementation(() => {});

    await ownerReq('put', '/api/payouts/po_1/status').send({
      status: 'paid',
      proofReference: '  ABSA-77  ',
    });

    expect(db.updatePayoutStatus).toHaveBeenCalledWith(
      'po_1',
      'paid',
      '',
      expect.objectContaining({ reference: 'ABSA-77' })
    );
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Outstanding balances across months
// ══════════════════════════════════════════════════════════════════════════════
describe('outstanding balances', () => {
  test('owner view aggregates unpaid months per venue', async () => {
    db.getAllVenuesOutstanding.mockReturnValue([
      {
        venueCode: 'VEN001',
        outstandingCents: 4900,
        outstandingRand: '49.00',
        unpaidMonths: 2,
        months: [],
      },
    ]);
    db.getVenue.mockReturnValue({ code: 'VEN001', name: 'The Bar', settings: {} });

    const res = await ownerReq('get', '/api/payouts/outstanding').send();

    expect(res.status).toBe(200);
    expect(res.body.totalCents).toBe(4900);
    expect(res.body.venueCount).toBe(1);
    expect(res.body.venues[0].venueName).toBe('The Bar');
  });

  test('venue view separates owed-from-past-months and earned-this-month', async () => {
    const venueCode = 'VEN001';
    // authMiddleware resolves the venue from the DB before the route runs.
    db.getVenue.mockReturnValue({ code: venueCode, name: 'The Bar', settings: {} });
    db.getVenueOutstanding.mockReturnValue({
      outstandingCents: 4900,
      outstandingRand: '49.00',
      unpaidMonths: 2,
      months: [],
    });
    db.getVenueEarningsForMonth.mockReturnValue({ grossCents: 2000, count: 3, payments: [] });

    const res = await request(app)
      .get(`/api/payouts/venue/${venueCode}/outstanding`)
      .set('Cookie', `auth_token=${makeVenueJwt(venueCode)}`);

    expect(res.status).toBe(200);
    expect(res.body.outstandingCents).toBe(4900);
    expect(res.body.thisMonth.venueAmountCents).toBe(1400); // 70% of 2000
    expect(res.body.venueSharePercent).toBe(70);
  });

  test('venue cannot read another venue outstanding balance', async () => {
    // Authed as OTHER1, requesting VEN001's balance — must be rejected.
    db.getVenue.mockReturnValue({ code: 'OTHER1', name: 'Other Bar', settings: {} });
    const res = await request(app)
      .get('/api/payouts/venue/VEN001/outstanding')
      .set('Cookie', `auth_token=${makeVenueJwt('OTHER1')}`);

    expect(res.status).toBe(403);
    expect(db.getVenueOutstanding).not.toHaveBeenCalled();
  });

  test('owner outstanding route requires auth', async () => {
    const res = await request(app).get('/api/payouts/outstanding');
    expect(res.status).toBe(401);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Reconciliation — payouts rollup vs raw payments
// ══════════════════════════════════════════════════════════════════════════════
describe('reconciliation cross-check', () => {
  test('balanced when the rollup matches the raw payments', async () => {
    db.getAllPayoutsForMonth.mockReturnValue([payout()]);
    db.getVenueEarningsForMonth.mockReturnValue({ grossCents: 5000, count: 2, payments: [] });

    const res = await ownerReq('get', '/api/payouts/reconcile?year=2026&month=6').send();

    expect(res.status).toBe(200);
    expect(res.body.balanced).toBe(true);
    expect(res.body.mismatchCount).toBe(0);
    expect(res.body.rows[0].venueDeltaCents).toBe(0);
  });

  test('flags a payout row whose amount disagrees with the payments', async () => {
    db.getAllPayoutsForMonth.mockReturnValue([payout({ venueAmountCents: 999999 })]);
    db.getVenueEarningsForMonth.mockReturnValue({ grossCents: 5000, count: 2, payments: [] });

    const res = await ownerReq('get', '/api/payouts/reconcile?year=2026&month=6').send();

    expect(res.status).toBe(200);
    expect(res.body.balanced).toBe(false);
    expect(res.body.mismatchCount).toBe(1);
    expect(res.body.rows[0].venueDeltaCents).toBe(999999 - 3500);
    expect(res.body.rows[0].recomputed.venueAmountCents).toBe(3500);
  });

  test('flags missing payments (gross recorded but no transactions)', async () => {
    db.getAllPayoutsForMonth.mockReturnValue([payout()]);
    db.getVenueEarningsForMonth.mockReturnValue({ grossCents: 0, count: 0, payments: [] });

    const res = await ownerReq('get', '/api/payouts/reconcile?year=2026&month=6').send();

    expect(res.status).toBe(200);
    expect(res.body.balanced).toBe(false);
    expect(res.body.rows[0].grossDeltaCents).toBe(5000);
  });

  test('reconcile requires owner auth', async () => {
    const res = await request(app).get('/api/payouts/reconcile');
    expect(res.status).toBe(401);
  });
});
