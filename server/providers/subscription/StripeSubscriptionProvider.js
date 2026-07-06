const SubscriptionProvider = require('./SubscriptionProvider');
const { stripeRequest, verifyStripeWebhookSignature } = require('../../utils/stripe');

/**
 * Stripe Billing implementation of the subscription interface.
 *
 * Flow mapping (the routes stay provider-agnostic):
 *   initCardCapture   → Checkout Session in `subscription` mode with a trial.
 *                       Stripe creates the subscription itself when the venue
 *                       owner completes checkout — no R1 authorization charge
 *                       is needed, so `amountZar` is ignored (the price comes
 *                       from the Stripe Price object).
 *   verifyCardCapture → find the subscription Checkout created, via
 *                       /v1/subscriptions/search on the reference we stamped
 *                       into subscription metadata. Search indexing can lag a
 *                       few seconds behind object creation, so we retry
 *                       briefly. The "reusable authorization" we hand back is
 *                       the subscription id itself.
 *   createSubscription→ the subscription already exists (Checkout made it);
 *                       we retrieve it by id and return it.
 *   getManageLink     → Stripe Billing Portal session (update card / cancel).
 *
 * Env:
 *   SUBSCRIPTION_PROVIDER=stripe
 *   STRIPE_SECRET_KEY                   sk_test_... / sk_live_...
 *   STRIPE_PRICE_ID                     price_... of the recurring plan
 *                                       (SUBSCRIPTION_PLAN_CODE works too)
 *   STRIPE_SUBSCRIPTION_WEBHOOK_SECRET  whsec_... for the endpoint pointing at
 *                                       /api/webhooks/subscription (falls back
 *                                       to STRIPE_WEBHOOK_SECRET)
 */
class StripeSubscriptionProvider extends SubscriptionProvider {
  constructor() {
    super();
    // Overridable in tests so retry paths don't sleep for real.
    this.searchRetryDelayMs = 1500;
    this.searchAttempts = 3;
  }

  get name() {
    return 'stripe';
  }

  getPriceId() {
    return process.env.STRIPE_PRICE_ID || process.env.SUBSCRIPTION_PLAN_CODE || '';
  }

  isConfigured() {
    return Boolean(process.env.STRIPE_SECRET_KEY && this.getPriceId());
  }

  async createCustomer({ email, firstName, lastName, phone, metadata }) {
    const name = [firstName, lastName].filter(Boolean).join(' ');
    const customer = await stripeRequest('POST', '/v1/customers', {
      email,
      ...(name && { name }),
      ...(phone && { phone }),
      metadata,
    });
    return { providerCustomerId: customer.id, raw: customer };
  }

  async initCardCapture({ email, reference, callbackUrl, metadata }) {
    const trialDays =
      parseInt(process.env.SUBSCRIPTION_TRIAL_DAYS || process.env.PAYSTACK_TRIAL_DAYS, 10) || 14;

    // Reuse the customer /start just created (looked up by email) so the
    // subscription lands on the stored customer instead of a duplicate one
    // Checkout would otherwise create.
    let customerId;
    try {
      const list = await stripeRequest('GET', '/v1/customers', { email, limit: 1 });
      customerId = list?.data?.[0]?.id;
    } catch (_) {
      // Fall through — Checkout will create a customer from customer_email.
    }

    const session = await stripeRequest('POST', '/v1/checkout/sessions', {
      mode: 'subscription',
      success_url: callbackUrl,
      cancel_url: callbackUrl,
      ...(customerId ? { customer: customerId } : { customer_email: email }),
      client_reference_id: reference,
      line_items: [{ price: this.getPriceId(), quantity: 1 }],
      subscription_data: {
        trial_period_days: trialDays,
        metadata: { reference, ...(metadata || {}) },
      },
      // Collect a card even though the trial means no charge today.
      payment_method_collection: 'always',
    });

    if (!session?.url) {
      const err = new Error('Invalid response from Stripe');
      err.code = 'PROVIDER_INVALID_RESPONSE';
      throw err;
    }
    return { authorizationUrl: session.url, reference, raw: session };
  }

  async verifyCardCapture(reference) {
    // The reference is server-generated (vbsub_<code>_<ts>) but strip quote
    // characters anyway so it can't break out of the search string.
    const safeRef = String(reference || '').replace(/['"\\]/g, '');

    let lastRaw = null;
    for (let attempt = 0; attempt < this.searchAttempts; attempt++) {
      if (attempt > 0 && this.searchRetryDelayMs > 0) {
        await new Promise((r) => setTimeout(r, this.searchRetryDelayMs));
      }
      const result = await stripeRequest('GET', '/v1/subscriptions/search', {
        query: `metadata['reference']:'${safeRef}'`,
        limit: 1,
      });
      lastRaw = result;
      const sub = result?.data?.[0];
      if (sub) {
        const ok = sub.status === 'trialing' || sub.status === 'active';
        return {
          verified: ok,
          reusableAuthorization: ok ? sub.id : undefined,
          raw: sub,
        };
      }
    }
    return { verified: false, raw: lastRaw };
  }

  async createSubscription({ authorization }) {
    // Checkout already created the subscription; `authorization` is its id.
    // Retrieve it so we fail loudly if it doesn't actually exist.
    const sub = await stripeRequest(
      'GET',
      `/v1/subscriptions/${encodeURIComponent(authorization)}`
    );
    return { providerSubscriptionId: sub.id, cancelToken: undefined, raw: sub };
  }

  async getManageLink({ providerSubscriptionId }) {
    const sub = await stripeRequest(
      'GET',
      `/v1/subscriptions/${encodeURIComponent(providerSubscriptionId)}`
    );
    const customer = typeof sub.customer === 'string' ? sub.customer : sub.customer?.id;
    const publicUrl = process.env.PUBLIC_URL || 'http://localhost:5173';
    const portal = await stripeRequest('POST', '/v1/billing_portal/sessions', {
      customer,
      return_url: `${publicUrl}/venue/billing`,
    });
    return { link: portal.url };
  }

  async cancel({ providerSubscriptionId }) {
    try {
      await stripeRequest(
        'DELETE',
        `/v1/subscriptions/${encodeURIComponent(providerSubscriptionId)}`
      );
    } catch (err) {
      // Idempotent: already-canceled or missing subscriptions resolve quietly.
      const alreadyGone =
        err.status === 404 || /no such subscription|already.*cancel/i.test(err.message || '');
      if (!alreadyGone) throw err;
    }
  }

  verifyWebhook(rawBody, headers) {
    const secret =
      process.env.STRIPE_SUBSCRIPTION_WEBHOOK_SECRET || process.env.STRIPE_WEBHOOK_SECRET;
    return verifyStripeWebhookSignature(rawBody, headers, secret);
  }

  normalizeWebhookEvent(payload) {
    const type = payload?.type || '';
    const obj = payload?.data?.object || {};
    const customerId = typeof obj.customer === 'string' ? obj.customer : obj.customer?.id;

    switch (type) {
      case 'customer.subscription.created':
      case 'customer.subscription.updated': {
        if (obj.status === 'trialing' || obj.status === 'active') {
          return {
            kind: 'subscription_activated',
            providerSubscriptionId: obj.id,
            providerCustomerId: customerId,
            nextPaymentDate: obj.current_period_end ? obj.current_period_end * 1000 : undefined,
            rawEvent: type,
          };
        }
        if (obj.status === 'canceled') {
          return {
            kind: 'subscription_canceled',
            providerSubscriptionId: obj.id,
            providerCustomerId: customerId,
            rawEvent: type,
          };
        }
        return { kind: 'unhandled', rawEvent: type };
      }
      case 'customer.subscription.deleted':
        return {
          kind: 'subscription_canceled',
          providerSubscriptionId: obj.id,
          providerCustomerId: customerId,
          rawEvent: type,
        };
      case 'invoice.paid':
      case 'invoice.payment_succeeded': {
        const subId = typeof obj.subscription === 'string' ? obj.subscription : obj.subscription?.id;
        // Skip $0 invoices (trial start) — no receipt for money that didn't move.
        if (!subId || !(obj.amount_paid > 0)) return { kind: 'unhandled', rawEvent: type };
        const periodEnd = obj.lines?.data?.[0]?.period?.end;
        return {
          kind: 'charge_succeeded',
          providerSubscriptionId: subId,
          providerCustomerId: customerId,
          nextPaymentDate: periodEnd ? periodEnd * 1000 : undefined,
          rawEvent: type,
        };
      }
      case 'invoice.payment_failed': {
        const subId = typeof obj.subscription === 'string' ? obj.subscription : obj.subscription?.id;
        if (!subId) return { kind: 'unhandled', rawEvent: type };
        return {
          kind: 'payment_failed',
          providerSubscriptionId: subId,
          providerCustomerId: customerId,
          rawEvent: type,
        };
      }
      default:
        return { kind: 'unhandled', rawEvent: type };
    }
  }
}

module.exports = StripeSubscriptionProvider;
