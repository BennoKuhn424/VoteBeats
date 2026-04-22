/**
 * @jest-environment node
 *
 * Unit tests for the requireSubscriptionActive gating middleware.
 *
 * Covers the three-way matrix:
 *   - no req.venue                         → 401
 *   - sub status in {trialing, active}     → next()
 *   - sub status in {past_due, canceled,
 *       incomplete}                        → 402
 *   - no subscription record:
 *       SUBSCRIPTION_ENFORCEMENT=lenient   → next() (grandfather)
 *       SUBSCRIPTION_ENFORCEMENT=strict    → 402
 */

jest.mock('../utils/database');

const db = require('../utils/database');
const requireSubscriptionActive = require('../middleware/requireSubscriptionActive');

function mockRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

const originalEnforcement = process.env.SUBSCRIPTION_ENFORCEMENT;

beforeEach(() => {
  jest.clearAllMocks();
  delete process.env.SUBSCRIPTION_ENFORCEMENT;
});

afterAll(() => {
  if (originalEnforcement === undefined) delete process.env.SUBSCRIPTION_ENFORCEMENT;
  else process.env.SUBSCRIPTION_ENFORCEMENT = originalEnforcement;
});

describe('requireSubscriptionActive', () => {
  test('returns 401 when req.venue is missing', () => {
    const req = {};
    const res = mockRes();
    const next = jest.fn();
    requireSubscriptionActive(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  test('lenient mode: no subscription record → next() (grandfather legacy venues)', () => {
    db.getSubscription.mockReturnValue(null);
    const req = { venue: { code: 'VEN001' } };
    const res = mockRes();
    const next = jest.fn();
    requireSubscriptionActive(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  test('strict mode: no subscription record → 402 SUBSCRIPTION_REQUIRED', () => {
    process.env.SUBSCRIPTION_ENFORCEMENT = 'strict';
    db.getSubscription.mockReturnValue(null);
    const req = { venue: { code: 'VEN001' } };
    const res = mockRes();
    const next = jest.fn();
    requireSubscriptionActive(req, res, next);
    expect(res.status).toHaveBeenCalledWith(402);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'SUBSCRIPTION_REQUIRED' }));
    expect(next).not.toHaveBeenCalled();
  });

  test('status=trialing → next()', () => {
    db.getSubscription.mockReturnValue({ status: 'trialing' });
    const req = { venue: { code: 'VEN001' } };
    const res = mockRes();
    const next = jest.fn();
    requireSubscriptionActive(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  test('status=active → next()', () => {
    db.getSubscription.mockReturnValue({ status: 'active' });
    const req = { venue: { code: 'VEN001' } };
    const res = mockRes();
    const next = jest.fn();
    requireSubscriptionActive(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  test('status=past_due → 402 SUBSCRIPTION_INACTIVE', () => {
    db.getSubscription.mockReturnValue({ status: 'past_due' });
    const req = { venue: { code: 'VEN001' } };
    const res = mockRes();
    const next = jest.fn();
    requireSubscriptionActive(req, res, next);
    expect(res.status).toHaveBeenCalledWith(402);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      code: 'SUBSCRIPTION_INACTIVE',
      subscriptionStatus: 'past_due',
    }));
    expect(next).not.toHaveBeenCalled();
  });

  test('status=canceled → 402 SUBSCRIPTION_INACTIVE', () => {
    db.getSubscription.mockReturnValue({ status: 'canceled' });
    const req = { venue: { code: 'VEN001' } };
    const res = mockRes();
    const next = jest.fn();
    requireSubscriptionActive(req, res, next);
    expect(res.status).toHaveBeenCalledWith(402);
    expect(next).not.toHaveBeenCalled();
  });

  test('status=incomplete → 402 SUBSCRIPTION_INACTIVE', () => {
    db.getSubscription.mockReturnValue({ status: 'incomplete' });
    const req = { venue: { code: 'VEN001' } };
    const res = mockRes();
    const next = jest.fn();
    requireSubscriptionActive(req, res, next);
    expect(res.status).toHaveBeenCalledWith(402);
    expect(next).not.toHaveBeenCalled();
  });

  test('status=none → treated as "no subscription" (lenient by default)', () => {
    db.getSubscription.mockReturnValue({ status: 'none' });
    const req = { venue: { code: 'VEN001' } };
    const res = mockRes();
    const next = jest.fn();
    requireSubscriptionActive(req, res, next);
    expect(next).toHaveBeenCalled();
  });
});
