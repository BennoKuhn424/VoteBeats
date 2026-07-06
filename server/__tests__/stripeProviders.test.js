/**
 * @jest-environment node
 *
 * Stripe provider layer:
 *   - utils/stripe: form encoding + webhook signature verification
 *   - StripePatronPaymentProvider: checkout create/verify + webhook normalize
 *   - StripeSubscriptionProvider: checkout-driven subscription flow
 *   - both factories resolve "stripe"
 *
 * All network calls are mocked via global.fetch — same approach as the
 * yoco/paystack provider tests.
 */

const crypto = require('crypto');

const ENV_KEYS = [
  'PATRON_PAYMENT_PROVIDER',
  'SUBSCRIPTION_PROVIDER',
  'STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRET',
  'STRIPE_SUBSCRIPTION_WEBHOOK_SECRET',
  'STRIPE_PRICE_ID',
  'SUBSCRIPTION_PLAN_CODE',
  'SUBSCRIPTION_TRIAL_DAYS',
];
const savedEnv = {};

beforeAll(() => {
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
});

afterAll(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

const originalFetch = global.fetch;

beforeEach(() => {
  jest.resetModules();
  process.env.STRIPE_SECRET_KEY = 'sk_test_fake';
  process.env.STRIPE_WEBHOOK_SECRET = 'whsec_patron_secret';
  process.env.STRIPE_PRICE_ID = 'price_fake123';
  delete process.env.STRIPE_SUBSCRIPTION_WEBHOOK_SECRET;
  delete process.env.SUBSCRIPTION_PLAN_CODE;
});

afterEach(() => {
  global.fetch = originalFetch;
});

/** Build a valid Stripe-Signature header for a raw body. */
function signStripe(rawBody, secret, tsSec = Math.floor(Date.now() / 1000)) {
  const sig = crypto.createHmac('sha256', secret).update(`${tsSec}.${rawBody}`).digest('hex');
  return `t=${tsSec},v1=${sig}`;
}

function okJson(data) {
  return { ok: true, json: async () => data };
}

// ══════════════════════════════════════════════════════════════════════════════
// utils/stripe
// ══════════════════════════════════════════════════════════════════════════════
describe('utils/stripe — formEncode', () => {
  test('flattens nested objects and arrays into bracket notation', () => {
    const { formEncode } = require('../utils/stripe');
    const pairs = formEncode({
      mode: 'payment',
      line_items: [{ quantity: 1, price_data: { currency: 'usd', unit_amount: 1500 } }],
      metadata: { venueCode: 'VN1' },
      skipped: null,
    });
    const asObj = Object.fromEntries(pairs);
    expect(asObj.mode).toBe('payment');
    expect(asObj['line_items[0][quantity]']).toBe('1');
    expect(asObj['line_items[0][price_data][currency]']).toBe('usd');
    expect(asObj['line_items[0][price_data][unit_amount]']).toBe('1500');
    expect(asObj['metadata[venueCode]']).toBe('VN1');
    expect('skipped' in asObj).toBe(false);
  });
});

describe('utils/stripe — verifyStripeWebhookSignature', () => {
  const { verifyStripeWebhookSignature } = require('../utils/stripe');
  const SECRET = 'whsec_test_secret';
  const BODY = Buffer.from('{"type":"checkout.session.completed"}');

  test('accepts a valid signature', () => {
    const header = signStripe(BODY.toString('utf8'), SECRET);
    expect(verifyStripeWebhookSignature(BODY, { 'stripe-signature': header }, SECRET)).toBe(true);
  });

  test('rejects a signature made with the wrong secret', () => {
    const header = signStripe(BODY.toString('utf8'), 'whsec_wrong');
    expect(verifyStripeWebhookSignature(BODY, { 'stripe-signature': header }, SECRET)).toBe(false);
  });

  test('rejects a stale timestamp (replay protection)', () => {
    const staleTs = Math.floor(Date.now() / 1000) - 600; // 10 minutes old
    const header = signStripe(BODY.toString('utf8'), SECRET, staleTs);
    expect(verifyStripeWebhookSignature(BODY, { 'stripe-signature': header }, SECRET)).toBe(false);
  });

  test('rejects a tampered body', () => {
    const header = signStripe(BODY.toString('utf8'), SECRET);
    const tampered = Buffer.from('{"type":"checkout.session.completed","amount":9}');
    expect(verifyStripeWebhookSignature(tampered, { 'stripe-signature': header }, SECRET)).toBe(false);
  });

  test('rejects when header or secret is missing', () => {
    expect(verifyStripeWebhookSignature(BODY, {}, SECRET)).toBe(false);
    const header = signStripe(BODY.toString('utf8'), SECRET);
    expect(verifyStripeWebhookSignature(BODY, { 'stripe-signature': header }, undefined)).toBe(false);
  });

  test('accepts when one of multiple v1 signatures matches (secret rotation)', () => {
    const ts = Math.floor(Date.now() / 1000);
    const good = crypto.createHmac('sha256', SECRET).update(`${ts}.${BODY}`).digest('hex');
    const bad = 'a'.repeat(64);
    const header = `t=${ts},v1=${bad},v1=${good}`;
    expect(verifyStripeWebhookSignature(BODY, { 'stripe-signature': header }, SECRET)).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Factories
// ══════════════════════════════════════════════════════════════════════════════
describe('provider factories resolve "stripe"', () => {
  test('patron-payment factory', () => {
    process.env.PATRON_PAYMENT_PROVIDER = 'stripe';
    jest.resetModules();
    const { getProvider } = require('../providers/payment');
    expect(getProvider().name).toBe('stripe');
    delete process.env.PATRON_PAYMENT_PROVIDER;
  });

  test('subscription factory', () => {
    process.env.SUBSCRIPTION_PROVIDER = 'stripe';
    jest.resetModules();
    const { getProvider } = require('../providers/subscription');
    expect(getProvider().name).toBe('stripe');
    delete process.env.SUBSCRIPTION_PROVIDER;
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// StripePatronPaymentProvider
// ══════════════════════════════════════════════════════════════════════════════
describe('StripePatronPaymentProvider', () => {
  function makeProvider() {
    const Provider = require('../providers/payment/StripePatronPaymentProvider');
    return new Provider();
  }

  test('isConfigured follows STRIPE_SECRET_KEY', () => {
    const provider = makeProvider();
    expect(provider.isConfigured()).toBe(true);
    delete process.env.STRIPE_SECRET_KEY;
    expect(provider.isConfigured()).toBe(false);
  });

  test('createCheckout posts a payment-mode session and maps id/url', async () => {
    global.fetch = jest.fn().mockResolvedValue(
      okJson({ id: 'cs_test_1', url: 'https://checkout.stripe.com/c/pay/cs_test_1' })
    );
    const provider = makeProvider();
    const r = await provider.createCheckout({
      amountCents: 1500,
      currency: 'USD',
      successUrl: 'https://app/s',
      cancelUrl: 'https://app/c',
      failureUrl: 'https://app/f',
      metadata: { venueCode: 'VN1' },
    });
    expect(r.checkoutId).toBe('cs_test_1');
    expect(r.redirectUrl).toBe('https://checkout.stripe.com/c/pay/cs_test_1');

    const [url, opts] = global.fetch.mock.calls[0];
    expect(url).toBe('https://api.stripe.com/v1/checkout/sessions');
    expect(opts.headers.Authorization).toBe('Bearer sk_test_fake');
    const body = new URLSearchParams(opts.body);
    expect(body.get('mode')).toBe('payment');
    expect(body.get('line_items[0][price_data][currency]')).toBe('usd');
    expect(body.get('line_items[0][price_data][unit_amount]')).toBe('1500');
    expect(body.get('metadata[venueCode]')).toBe('VN1');
  });

  test('createCheckout throws PROVIDER_NOT_CONFIGURED without a key', async () => {
    delete process.env.STRIPE_SECRET_KEY;
    const provider = makeProvider();
    await expect(provider.createCheckout({
      amountCents: 1000, successUrl: 'https://a/s', cancelUrl: 'https://a/c', failureUrl: 'https://a/f',
    })).rejects.toMatchObject({ code: 'PROVIDER_NOT_CONFIGURED' });
  });

  test('createCheckout surfaces Stripe errors as PROVIDER_CHECKOUT_FAILED', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ error: { message: 'Invalid currency', code: 'parameter_invalid' } }),
    });
    const provider = makeProvider();
    await expect(provider.createCheckout({
      amountCents: 1000, successUrl: 'https://a/s', cancelUrl: 'https://a/c', failureUrl: 'https://a/f',
    })).rejects.toMatchObject({ code: 'PROVIDER_CHECKOUT_FAILED', status: 400 });
  });

  test('createCheckout rejects a response missing id/url', async () => {
    global.fetch = jest.fn().mockResolvedValue(okJson({ object: 'checkout.session' }));
    const provider = makeProvider();
    await expect(provider.createCheckout({
      amountCents: 1000, successUrl: 'https://a/s', cancelUrl: 'https://a/c', failureUrl: 'https://a/f',
    })).rejects.toMatchObject({ code: 'PROVIDER_INVALID_RESPONSE' });
  });

  test('verifyCheckout: paid session → verified with amount', async () => {
    global.fetch = jest.fn().mockResolvedValue(
      okJson({ id: 'cs_test_1', payment_status: 'paid', amount_total: 1500 })
    );
    const provider = makeProvider();
    const r = await provider.verifyCheckout('cs_test_1');
    expect(r).toEqual({ verified: true, amountCents: 1500 });
  });

  test('verifyCheckout: unpaid session → not verified', async () => {
    global.fetch = jest.fn().mockResolvedValue(
      okJson({ id: 'cs_test_1', payment_status: 'unpaid', amount_total: 1500 })
    );
    const provider = makeProvider();
    const r = await provider.verifyCheckout('cs_test_1');
    expect(r.verified).toBe(false);
  });

  test('verifyCheckout: network/API failure → { verified: false }', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('ECONNRESET'));
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const provider = makeProvider();
    const r = await provider.verifyCheckout('cs_test_1');
    expect(r.verified).toBe(false);
    errSpy.mockRestore();
  });

  test('normalizeWebhookEvent: completed + paid → payment_succeeded', () => {
    const provider = makeProvider();
    const evt = provider.normalizeWebhookEvent({
      type: 'checkout.session.completed',
      data: { object: { id: 'cs_test_1', payment_status: 'paid', amount_total: 2000 } },
    });
    expect(evt).toMatchObject({ kind: 'payment_succeeded', checkoutId: 'cs_test_1', amountCents: 2000 });
  });

  test('normalizeWebhookEvent: completed but unpaid (async method) → unhandled', () => {
    const provider = makeProvider();
    const evt = provider.normalizeWebhookEvent({
      type: 'checkout.session.completed',
      data: { object: { id: 'cs_test_1', payment_status: 'unpaid' } },
    });
    expect(evt.kind).toBe('unhandled');
  });

  test('normalizeWebhookEvent: async_payment_succeeded → payment_succeeded', () => {
    const provider = makeProvider();
    const evt = provider.normalizeWebhookEvent({
      type: 'checkout.session.async_payment_succeeded',
      data: { object: { id: 'cs_test_2', payment_status: 'paid', amount_total: 500 } },
    });
    expect(evt).toMatchObject({ kind: 'payment_succeeded', checkoutId: 'cs_test_2', amountCents: 500 });
  });

  test('normalizeWebhookEvent: unrelated events / malformed → unhandled', () => {
    const provider = makeProvider();
    expect(provider.normalizeWebhookEvent({ type: 'charge.refunded' }).kind).toBe('unhandled');
    expect(provider.normalizeWebhookEvent({}).kind).toBe('unhandled');
    expect(provider.normalizeWebhookEvent(null).kind).toBe('unhandled');
  });

  test('verifyWebhook uses STRIPE_WEBHOOK_SECRET', () => {
    const provider = makeProvider();
    const body = Buffer.from('{"type":"checkout.session.completed"}');
    const header = signStripe(body.toString('utf8'), 'whsec_patron_secret');
    expect(provider.verifyWebhook(body, { 'stripe-signature': header })).toBe(true);
    expect(provider.verifyWebhook(body, { 'stripe-signature': signStripe(body.toString('utf8'), 'whsec_other') })).toBe(false);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// StripeSubscriptionProvider
// ══════════════════════════════════════════════════════════════════════════════
describe('StripeSubscriptionProvider', () => {
  function makeProvider() {
    const Provider = require('../providers/subscription/StripeSubscriptionProvider');
    const provider = new Provider();
    provider.searchRetryDelayMs = 0; // no real sleeping in tests
    return provider;
  }

  test('isConfigured requires key + price id (STRIPE_PRICE_ID or SUBSCRIPTION_PLAN_CODE)', () => {
    const provider = makeProvider();
    expect(provider.isConfigured()).toBe(true);

    delete process.env.STRIPE_PRICE_ID;
    expect(provider.isConfigured()).toBe(false);
    process.env.SUBSCRIPTION_PLAN_CODE = 'price_from_plan_code';
    expect(provider.isConfigured()).toBe(true);

    delete process.env.STRIPE_SECRET_KEY;
    expect(provider.isConfigured()).toBe(false);
  });

  test('createCustomer maps Stripe customer id', async () => {
    global.fetch = jest.fn().mockResolvedValue(okJson({ id: 'cus_123' }));
    const provider = makeProvider();
    const r = await provider.createCustomer({ email: 'owner@bar.com', firstName: 'The Bar' });
    expect(r.providerCustomerId).toBe('cus_123');
    const body = new URLSearchParams(global.fetch.mock.calls[0][1].body);
    expect(body.get('email')).toBe('owner@bar.com');
    expect(body.get('name')).toBe('The Bar');
  });

  test('initCardCapture reuses the customer by email and opens a subscription-mode session', async () => {
    process.env.SUBSCRIPTION_TRIAL_DAYS = '14';
    global.fetch = jest.fn()
      // 1: GET /v1/customers?email=... → existing customer
      .mockResolvedValueOnce(okJson({ data: [{ id: 'cus_123' }] }))
      // 2: POST /v1/checkout/sessions
      .mockResolvedValueOnce(okJson({ id: 'cs_sub_1', url: 'https://checkout.stripe.com/c/cs_sub_1' }));

    const provider = makeProvider();
    const r = await provider.initCardCapture({
      email: 'owner@bar.com',
      amountZar: 1,
      reference: 'vbsub_VN1_1720000000000',
      callbackUrl: 'https://app/venue/billing/complete?reference=vbsub_VN1_1720000000000',
      metadata: { venueCode: 'VN1' },
    });

    expect(r.authorizationUrl).toBe('https://checkout.stripe.com/c/cs_sub_1');
    expect(r.reference).toBe('vbsub_VN1_1720000000000');

    const body = new URLSearchParams(global.fetch.mock.calls[1][1].body);
    expect(body.get('mode')).toBe('subscription');
    expect(body.get('customer')).toBe('cus_123');
    expect(body.get('line_items[0][price]')).toBe('price_fake123');
    expect(body.get('subscription_data[trial_period_days]')).toBe('14');
    expect(body.get('subscription_data[metadata][reference]')).toBe('vbsub_VN1_1720000000000');
  });

  test('initCardCapture falls back to customer_email when lookup finds nothing', async () => {
    global.fetch = jest.fn()
      .mockResolvedValueOnce(okJson({ data: [] }))
      .mockResolvedValueOnce(okJson({ id: 'cs_sub_2', url: 'https://checkout.stripe.com/c/cs_sub_2' }));
    const provider = makeProvider();
    await provider.initCardCapture({
      email: 'owner@bar.com', amountZar: 1, reference: 'vbsub_X_1', callbackUrl: 'https://app/cb',
    });
    const body = new URLSearchParams(global.fetch.mock.calls[1][1].body);
    expect(body.get('customer')).toBeNull();
    expect(body.get('customer_email')).toBe('owner@bar.com');
  });

  test('verifyCardCapture finds the subscription by metadata reference', async () => {
    global.fetch = jest.fn().mockResolvedValue(
      okJson({ data: [{ id: 'sub_123', status: 'trialing' }] })
    );
    const provider = makeProvider();
    const r = await provider.verifyCardCapture('vbsub_VN1_1720000000000');
    expect(r.verified).toBe(true);
    expect(r.reusableAuthorization).toBe('sub_123');

    const url = global.fetch.mock.calls[0][0];
    expect(url).toContain('/v1/subscriptions/search');
    expect(decodeURIComponent(url)).toContain("metadata['reference']:'vbsub_VN1_1720000000000'");
  });

  test('verifyCardCapture retries the search, then reports not verified', async () => {
    global.fetch = jest.fn().mockResolvedValue(okJson({ data: [] }));
    const provider = makeProvider();
    const r = await provider.verifyCardCapture('vbsub_VN1_1720000000000');
    expect(r.verified).toBe(false);
    expect(global.fetch).toHaveBeenCalledTimes(provider.searchAttempts);
  });

  test('verifyCardCapture strips quote characters from the reference', async () => {
    global.fetch = jest.fn().mockResolvedValue(okJson({ data: [] }));
    const provider = makeProvider();
    await provider.verifyCardCapture("vbsub_'||true||'");
    expect(decodeURIComponent(global.fetch.mock.calls[0][0])).not.toContain("'||");
  });

  test('createSubscription retrieves the Checkout-created subscription by id', async () => {
    global.fetch = jest.fn().mockResolvedValue(okJson({ id: 'sub_123', status: 'trialing' }));
    const provider = makeProvider();
    const r = await provider.createSubscription({ authorization: 'sub_123', planCode: 'ignored' });
    expect(r.providerSubscriptionId).toBe('sub_123');
    expect(global.fetch.mock.calls[0][0]).toContain('/v1/subscriptions/sub_123');
  });

  test('getManageLink creates a billing-portal session for the sub’s customer', async () => {
    global.fetch = jest.fn()
      .mockResolvedValueOnce(okJson({ id: 'sub_123', customer: 'cus_123' }))
      .mockResolvedValueOnce(okJson({ url: 'https://billing.stripe.com/p/session_x' }));
    const provider = makeProvider();
    const r = await provider.getManageLink({ providerSubscriptionId: 'sub_123' });
    expect(r.link).toBe('https://billing.stripe.com/p/session_x');
    const body = new URLSearchParams(global.fetch.mock.calls[1][1].body);
    expect(body.get('customer')).toBe('cus_123');
  });

  test('cancel is idempotent: missing/already-canceled subscription resolves', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({ error: { message: 'No such subscription: sub_x' } }),
    });
    const provider = makeProvider();
    await expect(provider.cancel({ providerSubscriptionId: 'sub_x' })).resolves.toBeUndefined();
  });

  test('cancel rethrows unexpected errors', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ error: { message: 'internal' } }),
    });
    const provider = makeProvider();
    await expect(provider.cancel({ providerSubscriptionId: 'sub_x' })).rejects.toThrow();
  });

  test('normalizeWebhookEvent maps subscription lifecycle events', () => {
    const provider = makeProvider();

    expect(provider.normalizeWebhookEvent({
      type: 'customer.subscription.created',
      data: { object: { id: 'sub_1', customer: 'cus_1', status: 'trialing', current_period_end: 1_800_000_000 } },
    })).toMatchObject({
      kind: 'subscription_activated',
      providerSubscriptionId: 'sub_1',
      providerCustomerId: 'cus_1',
      nextPaymentDate: 1_800_000_000_000,
    });

    expect(provider.normalizeWebhookEvent({
      type: 'customer.subscription.updated',
      data: { object: { id: 'sub_1', status: 'canceled' } },
    }).kind).toBe('subscription_canceled');

    expect(provider.normalizeWebhookEvent({
      type: 'customer.subscription.deleted',
      data: { object: { id: 'sub_1' } },
    }).kind).toBe('subscription_canceled');

    expect(provider.normalizeWebhookEvent({
      type: 'invoice.paid',
      data: { object: { subscription: 'sub_1', amount_paid: 59900, lines: { data: [{ period: { end: 1_800_000_000 } }] } } },
    })).toMatchObject({ kind: 'charge_succeeded', providerSubscriptionId: 'sub_1', nextPaymentDate: 1_800_000_000_000 });

    // $0 trial-start invoice → no receipt
    expect(provider.normalizeWebhookEvent({
      type: 'invoice.paid',
      data: { object: { subscription: 'sub_1', amount_paid: 0 } },
    }).kind).toBe('unhandled');

    expect(provider.normalizeWebhookEvent({
      type: 'invoice.payment_failed',
      data: { object: { subscription: 'sub_1' } },
    }).kind).toBe('payment_failed');

    expect(provider.normalizeWebhookEvent({ type: 'price.updated' }).kind).toBe('unhandled');
    expect(provider.normalizeWebhookEvent(null).kind).toBe('unhandled');
  });

  test('verifyWebhook prefers STRIPE_SUBSCRIPTION_WEBHOOK_SECRET, falls back to STRIPE_WEBHOOK_SECRET', () => {
    const provider = makeProvider();
    const body = Buffer.from('{"type":"invoice.paid"}');

    // Fallback: only STRIPE_WEBHOOK_SECRET set
    let header = signStripe(body.toString('utf8'), 'whsec_patron_secret');
    expect(provider.verifyWebhook(body, { 'stripe-signature': header })).toBe(true);

    // Dedicated subscription secret wins
    process.env.STRIPE_SUBSCRIPTION_WEBHOOK_SECRET = 'whsec_sub_secret';
    expect(provider.verifyWebhook(body, { 'stripe-signature': header })).toBe(false);
    header = signStripe(body.toString('utf8'), 'whsec_sub_secret');
    expect(provider.verifyWebhook(body, { 'stripe-signature': header })).toBe(true);
  });
});
