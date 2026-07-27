const SubscriptionProvider = require('./SubscriptionProvider');
const payfast = require('../../utils/payfast');

/**
 * PayFast (by Network) subscription implementation.
 *
 * PayFast does not offer API-created subscriptions against a saved-card token
 * the way Paystack/Stripe do. Instead the recurring plan is defined INLINE on
 * a hosted checkout form (subscription_type=1 + frequency/cycles/recurring_
 * amount); PayFast then runs the recurring charges itself. That reshapes the
 * interface methods:
 *
 *   initCardCapture   → build the signed subscription checkout redirect. This
 *                       both captures the card AND creates the subscription;
 *                       there is no separate "charge the token later" step.
 *   verifyCardCapture → PayFast has no pre-charge verify-by-reference endpoint.
 *                       The real confirmation is the ITN webhook. We report
 *                       verified:false with no reusable token; the route relies
 *                       on the ITN (normalizeWebhookEvent) to activate the sub.
 *   createSubscription→ near no-op: the subscription already exists from
 *                       checkout. Returns the reference as the id until the ITN
 *                       supplies PayFast's real subscription token (pf_token /
 *                       m_payment_id correlation).
 *   getManageLink     → PayFast has no hosted manage surface → throws, so the
 *                       UI falls back to contact-support (allowed by interface).
 *
 * Env: see utils/payfast.js header.
 */
class PayfastSubscriptionProvider extends SubscriptionProvider {
  get name() {
    return 'payfast';
  }

  // Activation is driven by the ITN, not by /complete — see class comment.
  get activationVia() {
    return 'webhook';
  }

  isConfigured() {
    // PUBLIC_API_URL is not optional here: without it the checkout's
    // notify_url is garbage, the ITN never arrives, and no subscription can
    // ever activate — refuse up front instead of failing silently later.
    return Boolean(
      process.env.PAYFAST_MERCHANT_ID
        && process.env.PAYFAST_MERCHANT_KEY
        && process.env.PUBLIC_API_URL
    );
  }

  getTrialDays() {
    const n = parseInt(
      process.env.SUBSCRIPTION_TRIAL_DAYS || process.env.PAYSTACK_TRIAL_DAYS,
      10
    );
    return Number.isFinite(n) && n >= 0 ? n : 14;
  }

  getAmountZar(amountZar) {
    const n = parseInt(process.env.SUBSCRIPTION_AMOUNT_ZAR, 10);
    if (Number.isFinite(n) && n > 0) return n;
    return Number.isFinite(amountZar) && amountZar > 0 ? amountZar : 599;
  }

  // PayFast identifies the customer by email on the checkout form; there is no
  // separate customer object to create up front.
  async createCustomer({ email }) {
    return { providerCustomerId: email, raw: { email } };
  }

  /**
   * Build a signed PayFast subscription checkout. Returns the URL to redirect
   * the venue owner to. The trial is expressed as billing_date (first charge
   * delayed by trialDays); recurring_amount is the monthly fee.
   */
  async initCardCapture({ email, amountZar, reference, callbackUrl, metadata }) {
    if (!this.isConfigured()) {
      const err = new Error('PayFast not configured');
      err.code = 'PROVIDER_NOT_CONFIGURED';
      throw err;
    }

    const monthlyFee = this.getAmountZar(amountZar).toFixed(2);
    const trialDays = this.getTrialDays();

    // MONEY RULE — the venue must never pay twice for the first month:
    //  - With a trial: initial amount is 0.00 (PayFast's documented free-trial
    //    mechanism — the zero charge only tokenizes the card) and the first
    //    real charge is recurring_amount on billing_date = trial end.
    //  - Without a trial: the checkout charges the fee now, and billing_date
    //    is pushed one month out so the recurring engine bills the SECOND
    //    month, not today again.
    const initialAmount = trialDays > 0 ? '0.00' : monthlyFee;
    const firstRecurringCharge = trialDays > 0
      ? new Date(Date.now() + trialDays * 24 * 60 * 60 * 1000)
      : (() => { const d = new Date(); d.setMonth(d.getMonth() + 1); return d; })();
    const billingDate = firstRecurringCharge.toISOString().slice(0, 10); // YYYY-MM-DD

    const returnUrl = callbackUrl;
    const cancelUrl = callbackUrl;
    const notifyUrl = `${(process.env.PUBLIC_API_URL || '').replace(/\/$/, '')}/api/webhooks/subscription`;

    // Field ORDER matters for the signature — this is PayFast's documented
    // order for a subscription. Keep insertion order stable.
    const ordered = [
      ['merchant_id', process.env.PAYFAST_MERCHANT_ID],
      ['merchant_key', process.env.PAYFAST_MERCHANT_KEY],
      ['return_url', returnUrl],
      ['cancel_url', cancelUrl],
      ['notify_url', notifyUrl],
      ['email_address', email],
      ['m_payment_id', reference],
      ['amount', initialAmount],
      ['item_name', metadata?.itemName || 'Speeldit subscription'],
      ['subscription_type', '1'],
      ['billing_date', billingDate],
      ['recurring_amount', monthlyFee],
      ['frequency', '3'], // 3 = monthly
      ['cycles', '0'], // 0 = indefinite until cancelled
    ];

    const signature = payfast.signParams(ordered, process.env.PAYFAST_PASSPHRASE);
    const params = new URLSearchParams();
    for (const [k, v] of ordered) if (v !== undefined && v !== null && v !== '') params.append(k, v);
    params.append('signature', signature);

    const authorizationUrl = `${payfast.processHost()}/eng/process?${params.toString()}`;
    return { authorizationUrl, reference, raw: { billingDate, initialAmount, monthlyFee } };
  }

  // PayFast provides no pre-ITN verification endpoint. The ITN is the source of
  // truth (see normalizeWebhookEvent) — report not-yet-verified here.
  async verifyCardCapture(reference) {
    return { verified: false, reusableAuthorization: undefined, raw: { reference } };
  }

  // Subscription already created at checkout. Echo the reference back as the id;
  // the ITN will supply PayFast's real token and correlate via m_payment_id.
  async createSubscription({ authorization, providerCustomerId }) {
    return {
      providerSubscriptionId: authorization || providerCustomerId,
      cancelToken: undefined,
      raw: {},
    };
  }

  async getManageLink() {
    // No hosted management surface — signal the UI to use contact-support.
    const err = new Error('PayFast has no hosted subscription management link');
    err.code = 'PROVIDER_NO_MANAGE_LINK';
    throw err;
  }

  /**
   * Cancel via the PayFast API. Idempotent for an already-cancelled token
   * (payfast.cancelSubscription treats 404 as done).
   *
   * MONEY RULE — never resolve while PayFast may still be billing:
   *  - A real token → signed API cancel; API failure throws (route keeps our
   *    status unchanged, so the UI never claims "canceled" while charges
   *    continue).
   *  - Our own init reference (vbsub_…) means the activating ITN never arrived
   *    so we hold no PayFast token to address — throw rather than silently
   *    "cancel" locally while an unknown PayFast subscription keeps charging.
   */
  async cancel({ providerSubscriptionId }) {
    if (!providerSubscriptionId) return;
    if (String(providerSubscriptionId).startsWith('vbsub_')) {
      const err = new Error(
        'No PayFast subscription token on record (activation ITN never received) — cannot cancel at PayFast. Resolve manually via the PayFast dashboard.'
      );
      err.code = 'PROVIDER_CANCEL_UNADDRESSABLE';
      throw err;
    }
    await payfast.cancelSubscription(providerSubscriptionId);
  }

  /** ITN bodies are form-encoded, not JSON. */
  parseWebhookBody(rawBody) {
    return payfast.parseItnBody(rawBody);
  }

  /**
   * Verification layer 3: server-to-server postback to PayFast /validate.
   * Network errors propagate — the route answers non-2xx so PayFast retries.
   */
  async validateWebhook(rawBody) {
    return payfast.validateItn(rawBody);
  }

  /**
   * Verify an ITN. Signature + source-IP here; the server-to-server /validate
   * postback is done in the route so it can be stubbed in tests. `headers` must
   * carry the source IP via req (the route passes it through as x-real-ip).
   */
  verifyWebhook(rawBody, headers) {
    const sigOk = payfast.verifyItnSignature(rawBody, process.env.PAYFAST_PASSPHRASE);
    if (!sigOk) return false;
    const ip = headers['x-payfast-source-ip'] || headers['x-real-ip'] || '';
    // In sandbox the source-IP check is relaxed (requests come from your own
    // machine / PayFast sandbox), controlled by PAYFAST_SANDBOX.
    if (payfast.isSandbox()) return true;
    return payfast.isPayfastIp(ip);
  }

  normalizeWebhookEvent(payload) {
    // payload is the parsed ITN object.

    // A notification for someone else's merchant account is not ours to act
    // on, no matter how it got here. (Signature + IP + /validate all passed
    // by this point, so a mismatch means gross misconfiguration.)
    const ourMerchantId = process.env.PAYFAST_MERCHANT_ID;
    if (ourMerchantId && payload.merchant_id && String(payload.merchant_id) !== String(ourMerchantId)) {
      return { kind: 'unhandled', rawEvent: 'payfast:merchant-mismatch' };
    }

    const status = String(payload.payment_status || '').toUpperCase();
    // `token` is PayFast's durable subscription id. pf_payment_id is a
    // per-payment id — NOT a subscription handle — so it is deliberately not
    // used as a fallback here; the route correlates via `reference` instead.
    const token = payload.token || undefined;
    const reference = payload.m_payment_id || undefined;
    const providerSubscriptionId = token || reference;

    // A subscription payment (or the initial 0.00 tokenization) succeeded.
    if (status === 'COMPLETE') {
      return {
        kind: 'charge_succeeded',
        providerSubscriptionId,
        providerCustomerId: payload.email_address,
        nextPaymentDate: payload.billing_date ? new Date(payload.billing_date).getTime() : undefined,
        rawEvent: `payfast:${status}`,
        // Amount actually moved, for the route's amount guard. amount_gross
        // "0.00" must survive as the number 0 (trial tokenization), so only
        // undefined/absent maps to undefined.
        amountGrossZar: payload.amount_gross !== undefined && payload.amount_gross !== ''
          ? Number(payload.amount_gross)
          : undefined,
        reference,
      };
    }
    if (status === 'CANCELLED') {
      return { kind: 'subscription_canceled', providerSubscriptionId, reference, rawEvent: `payfast:${status}` };
    }
    return { kind: 'unhandled', rawEvent: `payfast:${status || 'unknown'}` };
  }
}

module.exports = PayfastSubscriptionProvider;
