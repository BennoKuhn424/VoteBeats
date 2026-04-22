const SubscriptionProvider = require('./SubscriptionProvider');
const paystack = require('../../utils/paystack');

/**
 * Paystack (Stripe's SA arm, ZAR recurring subscriptions) implementation.
 * Thin translation layer over `server/utils/paystack.js` — all network,
 * HMAC-SHA512, and request/response shape details live in that module.
 */
class PaystackSubscriptionProvider extends SubscriptionProvider {
  get name() {
    return 'paystack';
  }

  isConfigured() {
    return Boolean(process.env.PAYSTACK_SECRET_KEY && process.env.PAYSTACK_PLAN_CODE);
  }

  async createCustomer({ email, firstName, lastName, phone, metadata }) {
    const raw = await paystack.createCustomer({ email, firstName, lastName, phone, metadata });
    return { providerCustomerId: raw.customer_code, raw };
  }

  async initCardCapture({ email, amountZar, reference, callbackUrl, metadata }) {
    const raw = await paystack.initializeTransaction({
      email,
      amountZar,
      reference,
      callbackUrl,
      metadata,
      channels: ['card'],
    });
    return { authorizationUrl: raw.authorization_url, reference: raw.reference, raw };
  }

  async verifyCardCapture(reference) {
    const raw = await paystack.verifyTransaction(reference);
    const authorization = raw?.authorization;
    const success = raw?.status === 'success';
    const reusable = Boolean(success && authorization?.authorization_code && authorization?.reusable);
    return {
      verified: success,
      reusableAuthorization: reusable ? authorization.authorization_code : undefined,
      raw,
    };
  }

  async createSubscription({ providerCustomerId, planCode, authorization, startDate }) {
    const raw = await paystack.createSubscription({
      customerCode: providerCustomerId,
      planCode,
      authorizationCode: authorization,
      startDate,
    });
    return {
      providerSubscriptionId: raw.subscription_code,
      cancelToken: raw.email_token,
      raw,
    };
  }

  async getManageLink({ providerSubscriptionId }) {
    const raw = await paystack.generateManageLink(providerSubscriptionId);
    return { link: raw.link };
  }

  async cancel({ providerSubscriptionId, cancelToken }) {
    try {
      await paystack.disableSubscription({ code: providerSubscriptionId, emailToken: cancelToken });
    } catch (err) {
      // Paystack returns 400 "Subscription with code … is not active" if already canceled.
      const already = /not\s+active/i.test(err?.message || '');
      if (!already) throw err;
    }
  }

  verifyWebhook(rawBody, headers) {
    return paystack.verifyWebhookSignature(rawBody, headers['x-paystack-signature']);
  }

  normalizeWebhookEvent(payload) {
    const event = payload?.event || '';
    const data = payload?.data || {};
    const providerSubscriptionId = data.subscription_code
      || data.subscription?.subscription_code;
    const providerCustomerId = data.customer?.customer_code;
    const nextPaymentRaw = data.next_payment_date || data.subscription?.next_payment_date;
    const nextPaymentDate = nextPaymentRaw ? new Date(nextPaymentRaw).getTime() : undefined;

    switch (event) {
      case 'subscription.create':
      case 'subscription.enable':
        return { kind: 'subscription_activated', providerSubscriptionId, providerCustomerId, nextPaymentDate, rawEvent: event };
      case 'subscription.disable':
      case 'subscription.not_renew':
        return { kind: 'subscription_canceled', providerSubscriptionId, providerCustomerId, rawEvent: event };
      case 'charge.success': {
        // Ignore non-subscription charges (one-off R1 auth, unrelated payments).
        const isPlanCharge = Boolean(data.plan) || String(data.reference || '').startsWith('vbsub_');
        if (!isPlanCharge) return { kind: 'unhandled', rawEvent: event };
        return { kind: 'charge_succeeded', providerSubscriptionId, providerCustomerId, nextPaymentDate, rawEvent: event };
      }
      case 'invoice.payment_failed':
        return { kind: 'payment_failed', providerSubscriptionId, providerCustomerId, rawEvent: event };
      default:
        return { kind: 'unhandled', rawEvent: event };
    }
  }
}

module.exports = PaystackSubscriptionProvider;
