const PatronPaymentProvider = require('./PatronPaymentProvider');
const { stripeRequest, verifyStripeWebhookSignature } = require('../../utils/stripe');

/**
 * Stripe Checkout implementation of the patron-payment interface.
 *
 * Maps 1:1 onto the interface: createCheckout opens a hosted Checkout
 * Session (mode: payment), verifyCheckout retrieves the session and checks
 * payment_status, and the webhook handler receives checkout.session.completed
 * (or .async_payment_succeeded for delayed methods like bank debits).
 *
 * Env:
 *   PATRON_PAYMENT_PROVIDER=stripe
 *   STRIPE_SECRET_KEY        sk_test_... / sk_live_...
 *   STRIPE_WEBHOOK_SECRET    whsec_... from the Stripe endpoint pointing at
 *                            /api/webhooks/payment
 *   PAYMENT_CURRENCY         optional; the route passes it through (default ZAR)
 */
class StripePatronPaymentProvider extends PatronPaymentProvider {
  get name() {
    return 'stripe';
  }

  isConfigured() {
    return Boolean(process.env.STRIPE_SECRET_KEY);
  }

  async createCheckout({ amountCents, currency = 'ZAR', successUrl, cancelUrl, metadata }) {
    let session;
    try {
      session = await stripeRequest('POST', '/v1/checkout/sessions', {
        mode: 'payment',
        success_url: successUrl,
        cancel_url: cancelUrl,
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: String(currency).toLowerCase(),
              unit_amount: amountCents,
              product_data: { name: 'Song request' },
            },
          },
        ],
        metadata,
      });
    } catch (err) {
      if (err.code !== 'PROVIDER_NOT_CONFIGURED') err.code = 'PROVIDER_CHECKOUT_FAILED';
      throw err;
    }

    if (!session?.id || !session?.url) {
      const err = new Error('Invalid response from Stripe');
      err.code = 'PROVIDER_INVALID_RESPONSE';
      throw err;
    }
    return { checkoutId: session.id, redirectUrl: session.url, raw: session };
  }

  async verifyCheckout(checkoutId) {
    if (!this.isConfigured()) return { verified: false };
    try {
      const session = await stripeRequest(
        'GET',
        `/v1/checkout/sessions/${encodeURIComponent(checkoutId)}`
      );
      return {
        verified: session.payment_status === 'paid',
        amountCents: typeof session.amount_total === 'number' ? session.amount_total : null,
      };
    } catch (err) {
      console.error('Stripe verify call failed:', err.message);
      return { verified: false };
    }
  }

  verifyWebhook(rawBody, headers) {
    return verifyStripeWebhookSignature(rawBody, headers, process.env.STRIPE_WEBHOOK_SECRET);
  }

  normalizeWebhookEvent(payload) {
    const type = payload?.type;
    if (type !== 'checkout.session.completed' && type !== 'checkout.session.async_payment_succeeded') {
      return { kind: 'unhandled', rawEvent: type };
    }
    const session = payload.data?.object || {};
    // A completed session with a delayed payment method isn't paid yet — the
    // async_payment_succeeded event will follow when the money clears.
    if (session.payment_status && session.payment_status !== 'paid') {
      return { kind: 'unhandled', rawEvent: type };
    }
    return {
      kind: 'payment_succeeded',
      checkoutId: typeof session.id === 'string' ? session.id : undefined,
      amountCents: typeof session.amount_total === 'number' ? session.amount_total : undefined,
      rawEvent: type,
    };
  }
}

module.exports = StripePatronPaymentProvider;
