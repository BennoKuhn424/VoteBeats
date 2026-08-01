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

  test('returns 503 when the provider reports itself unconfigured (e.g. Paystack without a plan code)', async () => {
    // Each provider's isConfigured() owns its env requirements — the Paystack
    // plan-code requirement itself is pinned in subscriptionProvider.test.js.
    providerStub.isConfigured.mockReturnValue(false);
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

  // ── Double-checkout guard ──
  // An 'incomplete' subscription is not entitled and its status is neither
  // trialing nor active, so it slips past the ALREADY_SUBSCRIBED check above.
  // Without a separate guard a venue could open two hosted pages, complete
  // both, and leave the provider running two recurring subscriptions while the
  // one-row-per-venue table could only ever track (and cancel) the last token.
  test('refuses a second checkout while one is still in flight', async () => {
    db.getSubscription.mockReturnValue({ status: 'incomplete', venueCode: 'TSTSUB' });
    db.getOpenSubscriptionCheckout.mockReturnValue({
      reference: 'vbsub_TSTSUB_1', venueCode: 'TSTSUB', status: 'open', createdAt: Date.now() - 30_000,
    });
    const res = await authed('post', '/api/subscriptions/start', {});
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('CHECKOUT_IN_PROGRESS');
    expect(res.body.retryAfterMs).toBeGreaterThan(0);
    // Nothing may reach the provider — a second hosted page is the bug.
    expect(providerStub.initCardCapture).not.toHaveBeenCalled();
  });

  test('an abandoned checkout stops blocking once the lock window passes', async () => {
    // The venue must never be permanently trapped: that is the failure this
    // codebase already fixed once for lapsed subscriptions.
    db.getSubscription.mockReturnValue({ status: 'incomplete', venueCode: 'TSTSUB' });
    db.getOpenSubscriptionCheckout.mockReturnValue({
      reference: 'vbsub_TSTSUB_1', venueCode: 'TSTSUB', status: 'open', createdAt: Date.now() - 6 * 60 * 1000,
    });
    const res = await authed('post', '/api/subscriptions/start', {});
    expect(res.status).toBe(200);
    expect(res.body.authorizationUrl).toBeTruthy();
  });

  test('records the checkout in the ledger and supersedes older open ones', async () => {
    db.getSubscription.mockReturnValue(null);
    const res = await authed('post', '/api/subscriptions/start', {});
    expect(res.status).toBe(200);
    const reference = res.body.reference;
    // The subscriptions row keeps only the newest reference, so the ledger is
    // the only place an earlier checkout survives.
    expect(db.recordSubscriptionCheckout).toHaveBeenCalledWith(
      expect.objectContaining({ venueCode: 'TSTSUB' }),
    );
    expect(db.supersedeOpenSubscriptionCheckouts).toHaveBeenCalledWith('TSTSUB', expect.any(String));
    expect(reference).toMatch(/^vbsub_TSTSUB_/);
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

  test('webhook-activated provider (PayFast), free trial → activates immediately, no waiting on the ITN', async () => {
    db.getSubscriptionByInitReference.mockReturnValue({
      venueCode: 'TSTSUB',
      status: 'incomplete',
      providerCustomerId: 'cus_test',
    });
    providerStub.activationVia = 'webhook';
    try {
      const res = await authed('post', '/api/subscriptions/complete', { reference: REFERENCE });
      // A trial checkout moves R0.00, so there is no payment to confirm and no
      // reason to make the venue wait on an inbound webhook.
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('trialing');
      expect(res.body.pendingConfirmation).toBe(true);
      expect(res.body.trialEndsAt).toBeGreaterThan(Date.now());

      const saved = db.upsertSubscription.mock.calls[0][0];
      expect(saved.status).toBe('trialing');
      // Must stay unset: it is what tells the webhook this subscription has
      // never been confirmed, so the first ITN is still handled as the
      // activation rather than as a renewal.
      expect(saved.providerSubscriptionId).toBeFalsy();

      // Still nothing verified or created provider-side — that is the ITN's job.
      expect(providerStub.verifyCardCapture).not.toHaveBeenCalled();
      expect(providerStub.createSubscription).not.toHaveBeenCalled();
    } finally {
      delete providerStub.activationVia;
    }
  });

  test('webhook-activated provider, NO trial → still 202, real money waits for the ITN', async () => {
    db.getSubscriptionByInitReference.mockReturnValue({
      venueCode: 'TSTSUB',
      status: 'incomplete',
      providerCustomerId: 'cus_test',
    });
    providerStub.activationVia = 'webhook';
    const prevTrial = process.env.SUBSCRIPTION_TRIAL_DAYS;
    process.env.SUBSCRIPTION_TRIAL_DAYS = '0';
    try {
      const res = await authed('post', '/api/subscriptions/complete', { reference: REFERENCE });
      expect(res.status).toBe(202);
      expect(res.body.status).toBe('pending_activation');
      // Nothing may be activated on trust when the charge is real.
      expect(db.upsertSubscription).not.toHaveBeenCalled();
    } finally {
      delete providerStub.activationVia;
      if (prevTrial === undefined) delete process.env.SUBSCRIPTION_TRIAL_DAYS;
      else process.env.SUBSCRIPTION_TRIAL_DAYS = prevTrial;
    }
  });

  test('webhook-activated provider: once the ITN landed, /complete reports alreadyComplete', async () => {
    db.getSubscriptionByInitReference.mockReturnValue({
      venueCode: 'TSTSUB',
      status: 'trialing',
      providerCustomerId: 'cus_test',
    });
    providerStub.activationVia = 'webhook';
    try {
      const res = await authed('post', '/api/subscriptions/complete', { reference: REFERENCE });
      expect(res.status).toBe(200);
      expect(res.body.alreadyComplete).toBe(true);
      expect(res.body.status).toBe('trialing');
    } finally {
      delete providerStub.activationVia;
    }
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

/**
 * A lapsed subscription keeps its stored flag ('trialing'/'active') forever —
 * only checkVenueSubscription knows the period ran out. Echoing the raw flag
 * from /me, and gating /start on it, trapped venues completely: the page
 * insisted they were on a trial that ended months ago, offered Manage/Cancel
 * instead of a Start button, and /start refused with ALREADY_SUBSCRIBED. There
 * was no way out of that state from inside the app.
 */
describe('a lapsed subscription can be replaced', () => {
  const DAY = 24 * 60 * 60 * 1000;

  test('GET /me reports the effective status, not the stale stored flag', async () => {
    db.getSubscription.mockReturnValue({
      venueCode: 'TSTSUB',
      status: 'trialing',
      currentPeriodEnd: null,
      trialEndsAt: Date.now() - 60 * DAY,
    });

    const res = await authed('get', '/api/subscriptions/me');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('expired');
    expect(res.body.storedStatus).toBe('trialing');
    expect(res.body.entitled).toBe(false);
  });

  test('GET /me still reports a live trial as trialing', async () => {
    db.getSubscription.mockReturnValue({
      venueCode: 'TSTSUB',
      status: 'trialing',
      currentPeriodEnd: null,
      trialEndsAt: Date.now() + 5 * DAY,
    });

    const res = await authed('get', '/api/subscriptions/me');

    expect(res.body.status).toBe('trialing');
    expect(res.body.entitled).toBe(true);
  });

  test('GET /me names the active payment provider', async () => {
    db.getSubscription.mockReturnValue({
      venueCode: 'TSTSUB', status: 'active', currentPeriodEnd: Date.now() + 10 * DAY,
    });

    const res = await authed('get', '/api/subscriptions/me');

    expect(typeof res.body.provider === 'string' || res.body.provider === null).toBe(true);
  });
});

describe('/start is not blocked by a lapsed subscription', () => {
  const DAY = 24 * 60 * 60 * 1000;

  test('a venue whose trial lapsed can subscribe again', async () => {
    db.getSubscription.mockReturnValue({
      venueCode: 'TSTSUB', status: 'trialing', currentPeriodEnd: null, trialEndsAt: Date.now() - 60 * DAY,
    });

    const res = await authed('post', '/api/subscriptions/start', {});

    expect(res.status).toBe(200);
    expect(providerStub.createCustomer).toHaveBeenCalled();
  });

  test('a venue still inside its trial is still blocked from double-subscribing', async () => {
    db.getSubscription.mockReturnValue({
      venueCode: 'TSTSUB', status: 'trialing', currentPeriodEnd: null, trialEndsAt: Date.now() + 5 * DAY,
    });

    const res = await authed('post', '/api/subscriptions/start', {});

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('ALREADY_SUBSCRIBED');
    expect(providerStub.createCustomer).not.toHaveBeenCalled();
  });
});
