/**
 * @jest-environment node
 */

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

  test('skips verification when YOCO_WEBHOOK_SECRET is unset', () => {
    delete process.env.YOCO_WEBHOOK_SECRET;
    const { verifyYocoWebhookSignature } = require('../utils/yoco');
    expect(verifyYocoWebhookSignature(Buffer.from('{}'), {})).toBe(true);
  });
});
