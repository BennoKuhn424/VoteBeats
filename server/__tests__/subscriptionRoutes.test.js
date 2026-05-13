/**
 * @jest-environment node
 *
 * Subscription billing routes — covers the money paths:
 *   POST /api/subscriptions/start
 *   POST /api/subscriptions/complete
 *   POST /api/subscriptions/cancel
 *
 * Provider-level tests (PaystackSubscriptionProvider) live in
 * subscriptionProvider.test.js. This file integrates against the route layer
 * with a stubbed provider so we exercise:
 *   - The "already subscribed" guard on /start (prevents double-charge)
 *   - The reference-mismatch guard on /complete (prevents venue A confirming
 *     venue B's payment)
 *   - The reusable-authorization check on /complete (prevents creating a
 *     subscription against a card we can't recharge)
 *   - The idempotency-on-complete (replaying the callback is harmless)
 *   - The 503 when the provider is misconfigured (no plan code, etc.)
 *   - The /cancel happy path
 */

jest.mock('../utils/database');
jest.mock('../utils/email');
jest.mock('../utils/broadcast');
jest.mock('../repos/queueRepo');
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

// Stub the subscription provider factory so we can control what each call
// returns. NB: jest.mock factories can only reference variables prefixed with
// `mock`, so we expose the stub via a `mockProvider` variable + a getter.
jest.mock('../providers/subscription', () => {
  const mockProvider = {
    isConfigured: jest.fn(() => true),
    createCustomer: jest.fn(),
    initCardCapture: jest.fn(),
    verifyCardCapture: jest.fn(),
    createSubscription: jest.fn(),
    cancel: jest.fn(),
  };
  return {
    getProvider: () => mockProvider,
    __mockProvider: mockProvider,
  };
});

const request = require('supertest');
const jwt = require('jsonwebtoken');
const db = require('../utils/database');
const subscriptionProviderModule = require('../providers/subscription');
const providerStub = subscriptionProviderModule.__mockProvider;
const { app } = require('../app');

const JWT_SECRET = process.env.JWT_SECRET || 'speeldit-dev-secret-change-in-production';

function venueJwt(venueCode, csrf = 'csrf-tok') {
  return jwt.sign({ venueCode, csrf, jti: `jti-${venueCode}-${csrf}` }, JWT_SECRET, { expiresIn: '7d' });
}

function authed(method, path, body, venueCode = 'TSTSUB') {
  return request(app)
    [method](path)
    .set('Cookie', `auth_token=${venueJwt(venueCode)}`)
    .set('X-CSRF-Token', 'csrf-tok')
    .send(body);
}

const VENUE = {
  code: 'TSTSUB',
  name: 'Test Bar',
  owner: { email: 'owner@bar.com' },
  settings: {},
};

beforeEach(() => {
  jest.resetAllMocks();
  // Re-stub default provider behaviour after resetAllMocks
  providerStub.isConfigured.mockReturnValue(true);
  providerStub.createCustomer.mockResolvedValue({ providerCustomerId: 'cus_test' });
  providerStub.initCardCapture.mockResolvedValue({
    authorizationUrl: 'https://paystack.test/auth/abc',
    reference: 'vbsub_TSTSUB_123',
  });
  providerStub.verifyCardCapture.mockResolvedValue({
    verified: true,
    reusableAuthorization: 'AUTH_xyz',
  });
  providerStub.createSubscription.mockResolvedValue({
    providerSubscriptionId: 'sub_test',
    cancelToken: 'tok_test',
  });
  providerStub.cancel.mockResolvedValue(undefined);

  db.getVenue.mockReturnValue(VENUE);
  db.upsertSubscription.mockImplementation(() => {});

  // Plan code must be set for /start to pass requireProviderConfigured
  process.env.PAYSTACK_PLAN_CODE = 'PLN_test';
});

// ──────────────────────────────────────────────────────────────────────────────
// POST /api/subscriptions/start
// ──────────────────────────────────────────────────────────────────────────────
describe('POST /api/subscriptions/start', () => {
  test('returns 401 without auth', async () => {
    const res = await request(app).post('/api/subscriptions/start').send({});
    expect(res.status).toBe(401);
  });

  test('returns 503 when provider has no plan code configured', async () => {
    delete process.env.PAYSTACK_PLAN_CODE;
    delete process.env.SUBSCRIPTION_PLAN_CODE;
    const res = await authed('post', '/api/subscriptions/start', {});
    expect(res.status).toBe(503);
    expect(res.body.code).toBe('SUBSCRIPTION_NOT_CONFIGURED');
  });

  test('rejects when venue already has active subscription (prevents double-charge)', async () => {
    db.getSubscription.mockReturnValue({ status: 'active', venueCode: 'TSTSUB' });
    const res = await authed('post', '/api/subscriptions/start', {});
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('ALREADY_SUBSCRIBED');
    expect(providerStub.createCustomer).not.toHaveBeenCalled();
  });

  test('rejects when venue is trialing (no overlap)', async () => {
    db.getSubscription.mockReturnValue({ status: 'trialing', venueCode: 'TSTSUB' });
    const res = await authed('post', '/api/subscriptions/start', {});
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('ALREADY_SUBSCRIBED');
  });

  test('allows re-start when previous subscription is canceled', async () => {
    db.getSubscription.mockReturnValue({ status: 'canceled', venueCode: 'TSTSUB' });
    const res = await authed('post', '/api/subscriptions/start', {});
    expect(res.status).toBe(200);
    expect(res.body.authorizationUrl).toMatch(/^https:\/\/paystack/);
    expect(providerStub.createCustomer).toHaveBeenCalled();
  });

  test('happy path returns authorizationUrl + persists pending sub with init reference', async () => {
    db.getSubscription.mockReturnValue(null);
    const res = await authed('post', '/api/subscriptions/start', {});
    expect(res.status).toBe(200);
    expect(res.body.authorizationUrl).toBeTruthy();
    expect(res.body.reference).toBeTruthy();
    // Pending record persisted with status='incomplete' so /complete can look it up
    expect(db.upsertSubscription).toHaveBeenCalledWith(
      expect.objectContaining({
        venueCode: 'TSTSUB',
        status: 'incomplete',
        providerCustomerId: 'cus_test',
        paystackInitReference: expect.stringMatching(/^vbsub_TSTSUB_/),
      }),
    );
  });

  test('returns 502 if provider createCustomer throws', async () => {
    db.getSubscription.mockReturnValue(null);
    providerStub.createCustomer.mockRejectedValue(new Error('paystack down'));
    const res = await authed('post', '/api/subscriptions/start', {});
    expect(res.status).toBe(502);
    expect(res.body.code).toBe('SUBSCRIPTION_START_FAILED');
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// POST /api/subscriptions/complete
// ──────────────────────────────────────────────────────────────────────────────
describe('POST /api/subscriptions/complete', () => {
  const REFERENCE = 'vbsub_TSTSUB_999';

  test('returns 400 when reference is missing', async () => {
    const res = await authed('post', '/api/subscriptions/complete', {});
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('MISSING_REFERENCE');
  });

  test('returns 404 when reference is unknown to the DB', async () => {
    db.getSubscriptionByInitReference.mockReturnValue(null);
    const res = await authed('post', '/api/subscriptions/complete', { reference: REFERENCE });
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('UNKNOWN_REFERENCE');
  });

  test('returns 403 when reference belongs to a different venue (cross-venue attack)', async () => {
    db.getSubscriptionByInitReference.mockReturnValue({
      venueCode: 'OTHER1', // different from authed venue TSTSUB
      providerCustomerId: 'cus_other',
      status: 'incomplete',
    });
    const res = await authed('post', '/api/subscriptions/complete', { reference: REFERENCE });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('REFERENCE_MISMATCH');
    expect(providerStub.verifyCardCapture).not.toHaveBeenCalled();
  });

  test('idempotent — replaying a completed reference returns alreadyComplete:true', async () => {
    db.getSubscriptionByInitReference.mockReturnValue({
      venueCode: 'TSTSUB',
      status: 'trialing',
      providerCustomerId: 'cus_test',
    });
    const res = await authed('post', '/api/subscriptions/complete', { reference: REFERENCE });
    expect(res.status).toBe(200);
    expect(res.body.alreadyComplete).toBe(true);
    expect(providerStub.verifyCardCapture).not.toHaveBeenCalled();
    expect(providerStub.createSubscription).not.toHaveBeenCalled();
  });

  test('rejects when provider verification fails', async () => {
    db.getSubscriptionByInitReference.mockReturnValue({
      venueCode: 'TSTSUB',
      status: 'incomplete',
      providerCustomerId: 'cus_test',
    });
    providerStub.verifyCardCapture.mockResolvedValue({ verified: false });
    const res = await authed('post', '/api/subscriptions/complete', { reference: REFERENCE });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('AUTH_FAILED');
    expect(providerStub.createSubscription).not.toHaveBeenCalled();
  });

  test('rejects card that cannot be saved for recurring billing', async () => {
    db.getSubscriptionByInitReference.mockReturnValue({
      venueCode: 'TSTSUB',
      status: 'incomplete',
      providerCustomerId: 'cus_test',
    });
    providerStub.verifyCardCapture.mockResolvedValue({
      verified: true,
      reusableAuthorization: undefined, // non-reusable
    });
    const res = await authed('post', '/api/subscriptions/complete', { reference: REFERENCE });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('CARD_NOT_REUSABLE');
    expect(providerStub.createSubscription).not.toHaveBeenCalled();
  });

  test('happy path: creates subscription with 14-day trial and persists trialEndsAt', async () => {
    db.getSubscriptionByInitReference.mockReturnValue({
      venueCode: 'TSTSUB',
      status: 'incomplete',
      providerCustomerId: 'cus_test',
    });
    const before = Date.now();
    const res = await authed('post', '/api/subscriptions/complete', { reference: REFERENCE });
    const after = Date.now();

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('trialing');
    expect(res.body.trialEndsAt).toBeGreaterThanOrEqual(before + 14 * 24 * 60 * 60 * 1000 - 5_000);
    expect(res.body.trialEndsAt).toBeLessThanOrEqual(after + 14 * 24 * 60 * 60 * 1000 + 5_000);

    // start_date passed to provider must equal trialEndsAt so Paystack invoices start on day 14
    expect(providerStub.createSubscription).toHaveBeenCalledWith(
      expect.objectContaining({
        providerCustomerId: 'cus_test',
        startDate: res.body.trialEndsAt,
      }),
    );
    expect(db.upsertSubscription).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'trialing',
        venueCode: 'TSTSUB',
        trialEndsAt: res.body.trialEndsAt,
        paystackAuthorizationCode: 'AUTH_xyz',
      }),
    );
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// POST /api/subscriptions/cancel
// ──────────────────────────────────────────────────────────────────────────────
describe('POST /api/subscriptions/cancel', () => {
  test('returns 404 when no subscription exists', async () => {
    db.getSubscription.mockReturnValue(null);
    const res = await authed('post', '/api/subscriptions/cancel', {});
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('NO_SUBSCRIPTION');
  });

  test('returns 404 when subscription record exists but has no provider ID yet', async () => {
    db.getSubscription.mockReturnValue({ status: 'incomplete', providerSubscriptionId: null });
    const res = await authed('post', '/api/subscriptions/cancel', {});
    expect(res.status).toBe(404);
  });

  test('happy path: calls provider.cancel and persists status=canceled', async () => {
    db.getSubscription.mockReturnValue({
      venueCode: 'TSTSUB',
      status: 'active',
      providerSubscriptionId: 'sub_test',
      paystackEmailToken: 'tok_test',
    });
    const res = await authed('post', '/api/subscriptions/cancel', {});
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('canceled');
    expect(providerStub.cancel).toHaveBeenCalledWith({
      providerSubscriptionId: 'sub_test',
      cancelToken: 'tok_test',
    });
    expect(db.upsertSubscription).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'canceled' }),
    );
  });

  test('returns 502 if provider.cancel throws (non-idempotent failure)', async () => {
    db.getSubscription.mockReturnValue({
      venueCode: 'TSTSUB',
      status: 'active',
      providerSubscriptionId: 'sub_test',
      paystackEmailToken: 'tok_test',
    });
    providerStub.cancel.mockRejectedValue(new Error('paystack 500'));
    const res = await authed('post', '/api/subscriptions/cancel', {});
    expect(res.status).toBe(502);
    expect(res.body.code).toBe('SUBSCRIPTION_CANCEL_FAILED');
    // DB should NOT be marked canceled if the provider call failed
    expect(db.upsertSubscription).not.toHaveBeenCalled();
  });
});
