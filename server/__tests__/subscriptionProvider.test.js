/**
 * @jest-environment node
 *
 * Tests the provider-agnostic subscription layer:
 *   - factory picks paystack by default and falls back with a warning
 *   - PaystackSubscriptionProvider.normalizeWebhookEvent maps every
 *     provider event kind we act on to the normalized shape the route uses
 *   - createCustomer / initCardCapture / verifyCardCapture / createSubscription
 *     translate Paystack response shapes into the interface shape
 *   - cancel swallows "already canceled" so it stays idempotent
 *
 * Network calls are stubbed at the paystack util layer — we never hit
 * api.paystack.co in tests.
 */

const path = require('path');

function loadProviderFresh() {
  jest.resetModules();
  return require('../providers/subscription');
}

describe('subscription provider factory', () => {
  const originalEnv = process.env.SUBSCRIPTION_PROVIDER;

  afterEach(() => {
    if (originalEnv === undefined) delete process.env.SUBSCRIPTION_PROVIDER;
    else process.env.SUBSCRIPTION_PROVIDER = originalEnv;
    jest.resetModules();
  });

  test('defaults to paystack when SUBSCRIPTION_PROVIDER is unset', () => {
    delete process.env.SUBSCRIPTION_PROVIDER;
    const { getProvider } = loadProviderFresh();
    expect(getProvider().name).toBe('paystack');
  });

  test('caches the provider instance across calls', () => {
    const { getProvider } = loadProviderFresh();
    expect(getProvider()).toBe(getProvider());
  });

  test('falls back to paystack with warning for unknown provider name', () => {
    process.env.SUBSCRIPTION_PROVIDER = 'mystery_co';
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const { getProvider } = loadProviderFresh();
    expect(getProvider().name).toBe('paystack');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('mystery_co'));
    warn.mockRestore();
  });
});

describe('PaystackSubscriptionProvider.normalizeWebhookEvent', () => {
  let provider;
  beforeEach(() => {
    jest.resetModules();
    const Provider = require('../providers/subscription/PaystackSubscriptionProvider');
    provider = new Provider();
  });

  test('subscription.create → subscription_activated', () => {
    const evt = provider.normalizeWebhookEvent({
      event: 'subscription.create',
      data: {
        subscription_code: 'SUB_x1',
        customer: { customer_code: 'CUS_y1' },
        next_payment_date: '2026-05-22T00:00:00.000Z',
      },
    });
    expect(evt.kind).toBe('subscription_activated');
    expect(evt.providerSubscriptionId).toBe('SUB_x1');
    expect(evt.providerCustomerId).toBe('CUS_y1');
    expect(evt.nextPaymentDate).toBe(new Date('2026-05-22T00:00:00.000Z').getTime());
  });

  test('subscription.enable → subscription_activated', () => {
    expect(provider.normalizeWebhookEvent({ event: 'subscription.enable', data: { subscription_code: 'SUB_x' } }).kind)
      .toBe('subscription_activated');
  });

  test('subscription.disable and not_renew → subscription_canceled', () => {
    expect(provider.normalizeWebhookEvent({ event: 'subscription.disable', data: { subscription_code: 'SUB_x' } }).kind)
      .toBe('subscription_canceled');
    expect(provider.normalizeWebhookEvent({ event: 'subscription.not_renew', data: { subscription_code: 'SUB_x' } }).kind)
      .toBe('subscription_canceled');
  });

  test('charge.success with plan → charge_succeeded', () => {
    const evt = provider.normalizeWebhookEvent({
      event: 'charge.success',
      data: {
        plan: { plan_code: 'PLN_x' },
        subscription: { subscription_code: 'SUB_x', next_payment_date: '2026-06-01' },
      },
    });
    expect(evt.kind).toBe('charge_succeeded');
    expect(evt.providerSubscriptionId).toBe('SUB_x');
  });

  test('charge.success with vbsub_ reference but no plan → charge_succeeded', () => {
    const evt = provider.normalizeWebhookEvent({
      event: 'charge.success',
      data: { reference: 'vbsub_VENUE1_12345', subscription: { subscription_code: 'SUB_x' } },
    });
    expect(evt.kind).toBe('charge_succeeded');
  });

  test('charge.success for one-off patron payment (no plan, no vbsub) → unhandled', () => {
    const evt = provider.normalizeWebhookEvent({
      event: 'charge.success',
      data: { reference: 'some_patron_checkout' },
    });
    expect(evt.kind).toBe('unhandled');
  });

  test('invoice.payment_failed → payment_failed', () => {
    expect(provider.normalizeWebhookEvent({
      event: 'invoice.payment_failed',
      data: { subscription: { subscription_code: 'SUB_x' } },
    }).kind).toBe('payment_failed');
  });

  test('unknown event → unhandled', () => {
    expect(provider.normalizeWebhookEvent({ event: 'random.event', data: {} }).kind).toBe('unhandled');
  });

  test('completely empty payload → unhandled (doesn\'t throw)', () => {
    expect(provider.normalizeWebhookEvent({}).kind).toBe('unhandled');
    expect(provider.normalizeWebhookEvent(null).kind).toBe('unhandled');
  });
});

describe('PaystackSubscriptionProvider — response translation', () => {
  // These tests stub the paystack util to return canned responses, so we verify
  // the provider's translation layer without hitting the network.
  let provider;
  let paystack;

  beforeEach(() => {
    jest.resetModules();
    jest.doMock('../utils/paystack', () => ({
      createCustomer: jest.fn(),
      initializeTransaction: jest.fn(),
      verifyTransaction: jest.fn(),
      createSubscription: jest.fn(),
      generateManageLink: jest.fn(),
      disableSubscription: jest.fn(),
      verifyWebhookSignature: jest.fn(),
    }));
    paystack = require('../utils/paystack');
    const Provider = require('../providers/subscription/PaystackSubscriptionProvider');
    provider = new Provider();
  });

  afterEach(() => {
    jest.dontMock('../utils/paystack');
  });

  test('createCustomer maps customer_code → providerCustomerId', async () => {
    paystack.createCustomer.mockResolvedValue({ customer_code: 'CUS_abc', id: 1, email: 'x@y.com' });
    const r = await provider.createCustomer({ email: 'x@y.com', firstName: 'Test Venue' });
    expect(r.providerCustomerId).toBe('CUS_abc');
    expect(r.raw.customer_code).toBe('CUS_abc');
  });

  test('initCardCapture forces card-only channel', async () => {
    paystack.initializeTransaction.mockResolvedValue({
      authorization_url: 'https://checkout.paystack.com/abc',
      reference: 'vbsub_X_1',
    });
    await provider.initCardCapture({
      email: 'x@y.com',
      amountZar: 1,
      reference: 'vbsub_X_1',
      callbackUrl: 'https://app/complete?reference=vbsub_X_1',
    });
    expect(paystack.initializeTransaction).toHaveBeenCalledWith(
      expect.objectContaining({ channels: ['card'] })
    );
  });

  test('verifyCardCapture success + reusable authorization → reusableAuthorization returned', async () => {
    paystack.verifyTransaction.mockResolvedValue({
      status: 'success',
      authorization: { authorization_code: 'AUTH_xyz', reusable: true },
    });
    const r = await provider.verifyCardCapture('vbsub_X_1');
    expect(r.verified).toBe(true);
    expect(r.reusableAuthorization).toBe('AUTH_xyz');
  });

  test('verifyCardCapture success but non-reusable card → no reusableAuthorization', async () => {
    paystack.verifyTransaction.mockResolvedValue({
      status: 'success',
      authorization: { authorization_code: 'AUTH_xyz', reusable: false },
    });
    const r = await provider.verifyCardCapture('vbsub_X_1');
    expect(r.verified).toBe(true);
    expect(r.reusableAuthorization).toBeUndefined();
  });

  test('verifyCardCapture failed transaction → verified:false', async () => {
    paystack.verifyTransaction.mockResolvedValue({ status: 'failed' });
    const r = await provider.verifyCardCapture('vbsub_X_1');
    expect(r.verified).toBe(false);
  });

  test('createSubscription maps subscription_code + email_token → providerSubscriptionId + cancelToken', async () => {
    paystack.createSubscription.mockResolvedValue({
      subscription_code: 'SUB_xyz',
      email_token: 'tok_abc',
    });
    const r = await provider.createSubscription({
      providerCustomerId: 'CUS_a',
      planCode: 'PLN_a',
      authorization: 'AUTH_a',
      startDate: Date.now(),
    });
    expect(r.providerSubscriptionId).toBe('SUB_xyz');
    expect(r.cancelToken).toBe('tok_abc');
  });

  test('cancel swallows "not active" (idempotent on already-canceled)', async () => {
    paystack.disableSubscription.mockRejectedValue(new Error('Subscription with code SUB_x is not active'));
    await expect(provider.cancel({ providerSubscriptionId: 'SUB_x', cancelToken: 'tok' }))
      .resolves.toBeUndefined();
  });

  test('cancel rethrows other errors', async () => {
    paystack.disableSubscription.mockRejectedValue(new Error('Network error'));
    await expect(provider.cancel({ providerSubscriptionId: 'SUB_x', cancelToken: 'tok' }))
      .rejects.toThrow(/Network error/);
  });

  test('isConfigured requires both PAYSTACK_SECRET_KEY and PAYSTACK_PLAN_CODE', () => {
    const prev = { secret: process.env.PAYSTACK_SECRET_KEY, plan: process.env.PAYSTACK_PLAN_CODE };
    try {
      delete process.env.PAYSTACK_SECRET_KEY;
      delete process.env.PAYSTACK_PLAN_CODE;
      expect(provider.isConfigured()).toBe(false);
      process.env.PAYSTACK_SECRET_KEY = 'sk_x';
      expect(provider.isConfigured()).toBe(false);
      process.env.PAYSTACK_PLAN_CODE = 'PLN_x';
      expect(provider.isConfigured()).toBe(true);
    } finally {
      if (prev.secret !== undefined) process.env.PAYSTACK_SECRET_KEY = prev.secret;
      else delete process.env.PAYSTACK_SECRET_KEY;
      if (prev.plan !== undefined) process.env.PAYSTACK_PLAN_CODE = prev.plan;
      else delete process.env.PAYSTACK_PLAN_CODE;
    }
  });
});
