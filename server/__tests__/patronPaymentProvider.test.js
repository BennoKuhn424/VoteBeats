/**
 * @jest-environment node
 *
 * Tests the provider-agnostic patron-payment layer:
 *   - factory picks yoco by default and falls back with a warning
 *   - YocoPatronPaymentProvider.normalizeWebhookEvent handles all the
 *     payload shapes the Yoco webhook docs show
 *   - createCheckout translates Yoco response shape + surfaces provider errors
 *   - verifyCheckout delegates to the utils/yoco helper
 */

function loadFactoryFresh() {
  jest.resetModules();
  return require('../providers/payment');
}

describe('patron-payment provider factory', () => {
  const originalEnv = process.env.PATRON_PAYMENT_PROVIDER;

  afterEach(() => {
    if (originalEnv === undefined) delete process.env.PATRON_PAYMENT_PROVIDER;
    else process.env.PATRON_PAYMENT_PROVIDER = originalEnv;
    jest.resetModules();
  });

  test('defaults to yoco when PATRON_PAYMENT_PROVIDER is unset', () => {
    delete process.env.PATRON_PAYMENT_PROVIDER;
    const { getProvider } = loadFactoryFresh();
    expect(getProvider().name).toBe('yoco');
  });

  test('caches the provider instance across calls', () => {
    const { getProvider } = loadFactoryFresh();
    expect(getProvider()).toBe(getProvider());
  });

  test('falls back to yoco with warning for unknown provider name', () => {
    process.env.PATRON_PAYMENT_PROVIDER = 'mystery_co';
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const { getProvider } = loadFactoryFresh();
    expect(getProvider().name).toBe('yoco');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('mystery_co'));
    warn.mockRestore();
  });
});

describe('YocoPatronPaymentProvider.normalizeWebhookEvent', () => {
  let provider;
  beforeEach(() => {
    jest.resetModules();
    const Provider = require('../providers/payment/YocoPatronPaymentProvider');
    provider = new Provider();
  });

  test('payment.succeeded with metadata.checkoutId → payment_succeeded', () => {
    const evt = provider.normalizeWebhookEvent({
      type: 'payment.succeeded',
      payload: {
        metadata: { checkoutId: 'chk_abc' },
        amount: 1500,
      },
    });
    expect(evt.kind).toBe('payment_succeeded');
    expect(evt.checkoutId).toBe('chk_abc');
    expect(evt.amountCents).toBe(1500);
  });

  test('payment.succeeded falls back to payload.id when metadata.checkoutId missing', () => {
    const evt = provider.normalizeWebhookEvent({
      type: 'payment.succeeded',
      payload: { id: 'chk_xyz', amount: 500 },
    });
    expect(evt.kind).toBe('payment_succeeded');
    expect(evt.checkoutId).toBe('chk_xyz');
  });

  test('non-payment event types → unhandled', () => {
    expect(provider.normalizeWebhookEvent({ type: 'payment.failed' }).kind).toBe('unhandled');
    expect(provider.normalizeWebhookEvent({ type: 'refund.succeeded' }).kind).toBe('unhandled');
  });

  test('empty / malformed payloads → unhandled', () => {
    expect(provider.normalizeWebhookEvent({}).kind).toBe('unhandled');
    expect(provider.normalizeWebhookEvent(null).kind).toBe('unhandled');
  });

  test('payment.succeeded without checkoutId → kind:payment_succeeded but checkoutId undefined', () => {
    // Route handler treats this as a no-op (acks 200).
    const evt = provider.normalizeWebhookEvent({
      type: 'payment.succeeded',
      payload: { amount: 1000 },
    });
    expect(evt.kind).toBe('payment_succeeded');
    expect(evt.checkoutId).toBeUndefined();
  });
});

describe('YocoPatronPaymentProvider — createCheckout + verifyCheckout', () => {
  const originalFetch = global.fetch;
  const originalKey = process.env.YOCO_SECRET_KEY;

  beforeEach(() => {
    jest.resetModules();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.YOCO_SECRET_KEY;
    else process.env.YOCO_SECRET_KEY = originalKey;
  });

  test('createCheckout throws PROVIDER_NOT_CONFIGURED when YOCO_SECRET_KEY missing', async () => {
    delete process.env.YOCO_SECRET_KEY;
    const Provider = require('../providers/payment/YocoPatronPaymentProvider');
    const provider = new Provider();
    await expect(provider.createCheckout({
      amountCents: 1000,
      successUrl: 'https://a/s',
      cancelUrl: 'https://a/c',
      failureUrl: 'https://a/f',
    })).rejects.toMatchObject({ code: 'PROVIDER_NOT_CONFIGURED' });
  });

  test('createCheckout maps Yoco response id/redirectUrl → checkoutId/redirectUrl', async () => {
    process.env.YOCO_SECRET_KEY = 'sk_test_fake';
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'chk_abc', redirectUrl: 'https://pay.yoco/abc' }),
    });

    const Provider = require('../providers/payment/YocoPatronPaymentProvider');
    const provider = new Provider();
    const r = await provider.createCheckout({
      amountCents: 1500,
      successUrl: 'https://app/s',
      cancelUrl: 'https://app/c',
      failureUrl: 'https://app/f',
      metadata: { venueCode: 'VN1' },
    });
    expect(r.checkoutId).toBe('chk_abc');
    expect(r.redirectUrl).toBe('https://pay.yoco/abc');
    expect(global.fetch).toHaveBeenCalledWith(
      'https://payments.yoco.com/api/checkouts',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer sk_test_fake' }),
      })
    );
  });

  test('createCheckout surfaces provider error on non-ok response', async () => {
    process.env.YOCO_SECRET_KEY = 'sk_test_fake';
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ message: 'bad amount' }),
    });
    const Provider = require('../providers/payment/YocoPatronPaymentProvider');
    const provider = new Provider();
    await expect(provider.createCheckout({
      amountCents: 100,
      successUrl: 'https://app/s',
      cancelUrl: 'https://app/c',
      failureUrl: 'https://app/f',
    })).rejects.toMatchObject({ code: 'PROVIDER_CHECKOUT_FAILED', status: 400 });
  });

  test('createCheckout rejects response missing id/redirectUrl', async () => {
    process.env.YOCO_SECRET_KEY = 'sk_test_fake';
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ notWhatWeExpected: true }),
    });
    const Provider = require('../providers/payment/YocoPatronPaymentProvider');
    const provider = new Provider();
    await expect(provider.createCheckout({
      amountCents: 1000,
      successUrl: 'https://app/s',
      cancelUrl: 'https://app/c',
      failureUrl: 'https://app/f',
    })).rejects.toMatchObject({ code: 'PROVIDER_INVALID_RESPONSE' });
  });

  test('verifyCheckout returns { verified:false } when YOCO_SECRET_KEY missing', async () => {
    delete process.env.YOCO_SECRET_KEY;
    const Provider = require('../providers/payment/YocoPatronPaymentProvider');
    const provider = new Provider();
    const r = await provider.verifyCheckout('chk_x');
    expect(r.verified).toBe(false);
  });

  test('verifyCheckout delegates to utils/yoco when configured', async () => {
    process.env.YOCO_SECRET_KEY = 'sk_test_fake';
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ status: 'completed', amount: 1500, paymentId: 'pay_1' }),
    });
    const Provider = require('../providers/payment/YocoPatronPaymentProvider');
    const provider = new Provider();
    const r = await provider.verifyCheckout('chk_abc');
    expect(r.verified).toBe(true);
    expect(r.amountCents).toBe(1500);
  });

  test('isConfigured follows YOCO_SECRET_KEY', () => {
    const Provider = require('../providers/payment/YocoPatronPaymentProvider');
    const provider = new Provider();

    process.env.YOCO_SECRET_KEY = 'sk_test';
    expect(provider.isConfigured()).toBe(true);
    delete process.env.YOCO_SECRET_KEY;
    expect(provider.isConfigured()).toBe(false);
  });
});
