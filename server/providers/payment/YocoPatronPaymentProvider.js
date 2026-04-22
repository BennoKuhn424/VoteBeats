const PatronPaymentProvider = require('./PatronPaymentProvider');
const yoco = require('../../utils/yoco');

/**
 * Yoco Checkout implementation. All HMAC / network details live in
 * `server/utils/yoco.js`; this class is the translation layer between
 * Yoco's response shapes and our normalized provider interface.
 */
class YocoPatronPaymentProvider extends PatronPaymentProvider {
  get name() {
    return 'yoco';
  }

  isConfigured() {
    return Boolean(process.env.YOCO_SECRET_KEY);
  }

  async createCheckout({ amountCents, currency = 'ZAR', successUrl, cancelUrl, failureUrl, metadata }) {
    const secret = process.env.YOCO_SECRET_KEY;
    if (!secret) {
      const err = new Error('YOCO_SECRET_KEY not set');
      err.code = 'PROVIDER_NOT_CONFIGURED';
      throw err;
    }

    const response = await fetch('https://payments.yoco.com/api/checkouts', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${secret}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ amount: amountCents, currency, successUrl, cancelUrl, failureUrl, metadata }),
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      const err = new Error(errData.message || `Yoco checkout failed (${response.status})`);
      err.status = response.status;
      err.code = 'PROVIDER_CHECKOUT_FAILED';
      throw err;
    }

    const data = await response.json();
    if (!data?.id || !data?.redirectUrl) {
      const err = new Error('Invalid response from Yoco');
      err.code = 'PROVIDER_INVALID_RESPONSE';
      throw err;
    }
    return { checkoutId: data.id, redirectUrl: data.redirectUrl, raw: data };
  }

  async verifyCheckout(checkoutId) {
    const secret = process.env.YOCO_SECRET_KEY;
    if (!secret) return { verified: false };
    return yoco.verifyCheckoutWithYoco(checkoutId, secret);
  }

  verifyWebhook(rawBody, headers) {
    return yoco.verifyYocoWebhookSignature(rawBody, headers);
  }

  normalizeWebhookEvent(payload) {
    if (!payload || payload.type !== 'payment.succeeded') {
      return { kind: 'unhandled', rawEvent: payload?.type };
    }
    const checkoutId =
      payload.payload?.metadata?.checkoutId ?? payload.payload?.id ?? payload.id;
    const amountCents = payload.payload?.amount ?? payload.payload?.payment?.amount ?? null;
    return {
      kind: 'payment_succeeded',
      checkoutId: typeof checkoutId === 'string' ? checkoutId : undefined,
      amountCents: typeof amountCents === 'number' ? amountCents : undefined,
      rawEvent: payload.type,
    };
  }
}

module.exports = YocoPatronPaymentProvider;
