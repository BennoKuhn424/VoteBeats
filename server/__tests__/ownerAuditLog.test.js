/**
 * @jest-environment node
 *
 * GET /api/owner/audit-log — read-only audit log viewer for the platform owner.
 *
 * Property under test: the endpoint is strictly owner-only, applies filter
 * parameters correctly, and never leaks audit entries to a non-owner (venue
 * owner or unauthenticated request).
 *
 * The write side (recordAuditEvent) is exercised in payouts.test.js where the
 * payout flows emit audit events. Here we focus on the read path.
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

function ownerJwt() {
  return jwt.sign({ role: 'owner', csrf: 'csrf-tok', jti: 'jti-owner' }, JWT_SECRET, { expiresIn: '7d' });
}
function venueJwt(venueCode = 'TSTAUD') {
  return jwt.sign({ venueCode, csrf: 'csrf-tok', jti: `jti-${venueCode}` }, JWT_SECRET, { expiresIn: '7d' });
}

beforeEach(() => {
  jest.resetAllMocks();
  db.getAuditLog.mockReturnValue([]);
  db.getVenue.mockImplementation((code) => ({ code, name: 'Test', owner: { email: 'o@bar.com' } }));
});

describe('GET /api/owner/audit-log', () => {
  test('returns 401 without authentication', async () => {
    const res = await request(app).get('/api/owner/audit-log');
    expect(res.status).toBe(401);
    expect(db.getAuditLog).not.toHaveBeenCalled();
  });

  test('returns 403 when a venue owner (not the platform owner) tries to read', async () => {
    const res = await request(app)
      .get('/api/owner/audit-log')
      .set('Cookie', `auth_token=${venueJwt('TSTAUD')}`);
    expect(res.status).toBe(403);
    expect(db.getAuditLog).not.toHaveBeenCalled();
  });

  test('owner reads audit log successfully (no filters)', async () => {
    db.getAuditLog.mockReturnValue([
      {
        id: 1,
        actor_role: 'owner',
        actor_id: 'jti-owner',
        action: 'payout.generate',
        target_type: 'payout-batch',
        target_id: '2026-04',
        venue_code: null,
        ip: '127.0.0.1',
        detail: '{"created":3}',
        created_at: 1700000000000,
      },
    ]);
    const res = await request(app)
      .get('/api/owner/audit-log')
      .set('Cookie', `auth_token=${ownerJwt()}`);
    expect(res.status).toBe(200);
    expect(res.body.entries).toHaveLength(1);
    // Snake-case columns are mapped to camelCase in the response
    expect(res.body.entries[0]).toMatchObject({
      id: 1,
      actorRole: 'owner',
      action: 'payout.generate',
      targetType: 'payout-batch',
      targetId: '2026-04',
      ip: '127.0.0.1',
    });
    // JSON detail must be parsed into an object, not left as a string
    expect(res.body.entries[0].detail).toEqual({ created: 3 });
  });

  test('non-JSON detail strings pass through unchanged (forward-compat for legacy rows)', async () => {
    db.getAuditLog.mockReturnValue([
      {
        id: 2,
        actor_role: 'owner',
        action: 'test',
        target_type: 't',
        target_id: 'x',
        detail: 'plain-text-note',
        created_at: 1700000000000,
      },
    ]);
    const res = await request(app)
      .get('/api/owner/audit-log')
      .set('Cookie', `auth_token=${ownerJwt()}`);
    expect(res.status).toBe(200);
    expect(res.body.entries[0].detail).toBe('plain-text-note');
  });

  test('passes filter parameters through to the DB layer', async () => {
    const res = await request(app)
      .get('/api/owner/audit-log')
      .query({
        actorRole: 'owner',
        targetType: 'payout',
        targetId: 'po_abc',
        venueCode: 'TSTAUD',
        sinceMs: '1700000000000',
        limit: '50',
      })
      .set('Cookie', `auth_token=${ownerJwt()}`);
    expect(res.status).toBe(200);
    expect(db.getAuditLog).toHaveBeenCalledWith({
      actorRole: 'owner',
      targetType: 'payout',
      targetId: 'po_abc',
      venueCode: 'TSTAUD',
      sinceMs: 1700000000000,
      limit: 50,
    });
  });

  test('returns empty entries array when no rows match', async () => {
    db.getAuditLog.mockReturnValue([]);
    const res = await request(app)
      .get('/api/owner/audit-log')
      .set('Cookie', `auth_token=${ownerJwt()}`);
    expect(res.status).toBe(200);
    expect(res.body.entries).toEqual([]);
  });

  test('returns 500 when DB throws (route does not leak internals)', async () => {
    db.getAuditLog.mockImplementation(() => {
      throw new Error('disk read failed');
    });
    const res = await request(app)
      .get('/api/owner/audit-log')
      .set('Cookie', `auth_token=${ownerJwt()}`);
    expect(res.status).toBe(500);
    // Response must not contain the raw exception message
    expect(JSON.stringify(res.body)).not.toMatch(/disk read failed/i);
  });
});
