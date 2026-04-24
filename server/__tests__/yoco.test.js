/**
 * @jest-environment node
 */
const crypto = require('crypto');

describe('verifyCheckoutWithYoco', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.resetModules();
  });

  test('returns verified true when Yoco API reports completed', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        status: 'completed',
        amount: 1500,
        paymentId: 'pay_1',
      }),
    });

    const { verifyCheckoutWithYoco } = require('../utils/yoco');
    const r = await verifyCheckoutWithYoco('chk_test123', 'sk_test_fake');
    expect(r.verified).toBe(true);
    expect(r.amountCents).toBe(1500);
    expect(global.fetch).toHaveBeenCalledWith(
      'https://payments.yoco.com/api/checkouts/chk_test123',
      expect.objectContaining({
        headers: { Authorization: 'Bearer sk_test_fake' },
      })
    );
  });

  test('returns verified false when API not ok', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false });

    const { verifyCheckoutWithYoco } = require('../utils/yoco');
    const r = await verifyCheckoutWithYoco('chk_x', 'sk_test');
    expect(r.verified).toBe(false);
  });

  test('returns verified false on network error', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('network'));

    const { verifyCheckoutWithYoco } = require('../utils/yoco');
    const r = await verifyCheckoutWithYoco('chk_x', 'sk_test');
    expect(r.verified).toBe(false);
  });
});

describe('verifyYocoWebhookSignature', () => {
  const originalSecret = process.env.YOCO_WEBHOOK_SECRET;

  afterEach(() => {
    process.env.YOCO_WEBHOOK_SECRET = originalSecret;
    jest.resetModules();
  });

  test('fails verification when YOCO_WEBHOOK_SECRET is unset', () => {
    delete process.env.YOCO_WEBHOOK_SECRET;
    const { verifyYocoWebhookSignature } = require('../utils/yoco');
    expect(verifyYocoWebhookSignature(Buffer.from('{}'), {})).toBe(false);
  });

  test('accepts a valid signed webhook body', () => {
    const secretBytes = Buffer.from('webhook-test-secret');
    process.env.YOCO_WEBHOOK_SECRET = `whsec_${secretBytes.toString('base64')}`;
    const raw = Buffer.from(JSON.stringify({ type: 'payment.succeeded' }));
    const webhookId = 'evt_123';
    const webhookTs = String(Math.floor(Date.now() / 1000));
    const signedContent = `${webhookId}.${webhookTs}.${raw.toString('utf8')}`;
    const sig = crypto.createHmac('sha256', secretBytes).update(signedContent).digest('base64');

    const { verifyYocoWebhookSignature } = require('../utils/yoco');
    expect(verifyYocoWebhookSignature(raw, {
      'webhook-id': webhookId,
      'webhook-timestamp': webhookTs,
      'webhook-signature': `v1,${sig}`,
    })).toBe(true);
  });

  test('rejects malformed or stale signed webhooks', () => {
    const secretBytes = Buffer.from('webhook-test-secret');
    process.env.YOCO_WEBHOOK_SECRET = `whsec_${secretBytes.toString('base64')}`;
    const raw = Buffer.from('{}');
    const { verifyYocoWebhookSignature } = require('../utils/yoco');

    expect(verifyYocoWebhookSignature(raw, {
      'webhook-id': 'evt_123',
      'webhook-timestamp': String(Math.floor(Date.now() / 1000)),
      'webhook-signature': 'v1,invalid',
    })).toBe(false);

    expect(verifyYocoWebhookSignature(raw, {
      'webhook-id': 'evt_123',
      'webhook-timestamp': String(Math.floor(Date.now() / 1000) - 181),
      'webhook-signature': 'v1,invalid',
    })).toBe(false);
  });
});
