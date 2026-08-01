/**
 * Venue subscription routes.
 *
 * Provider-agnostic: depends only on the SubscriptionProvider interface in
 * server/providers/subscription. Swap billing vendors via SUBSCRIPTION_PROVIDER
 * — routes don't change.
 *
 * Flow:
 *   1. POST /start            → init card capture, return hosted authorization URL
 *   2. (patron on hosted page)→ card authorised, redirected to /venue/billing/complete
 *   3. POST /complete         → verify reference, create subscription w/ trial start date
 *   4. Provider bills on day TRIAL_DAYS, then each period; webhook updates status
 *   5. POST /cancel           → disable subscription immediately
 */

const express = require('express');
const db = require('../utils/database');
const authMiddleware = require('../middleware/authMiddleware');
const { getProvider } = require('../providers/subscription');
const { checkVenueSubscription } = require('../middleware/requireSubscriptionActive');
const { sendTrialStartedEmail } = require('../utils/email');

const router = express.Router();

// Read at call time (not module load) so tests and live config changes see the
// current value — same convention as subscriptionAmountZar() in the webhook
// route. Zero is meaningful here (it switches the venue to a paid signup with
// no trial), so an explicit 0 must survive rather than falling through to 14.
function trialDays() {
  const raw = process.env.SUBSCRIPTION_TRIAL_DAYS ?? process.env.PAYSTACK_TRIAL_DAYS;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n >= 0 ? n : 14;
}
const SUBSCRIPTION_AMOUNT_ZAR = parseInt(
  process.env.SUBSCRIPTION_AMOUNT_ZAR || process.env.PAYSTACK_SUBSCRIPTION_AMOUNT_ZAR,
  10,
) || 599;
const AUTH_CHARGE_ZAR = 1; // Small authorisation hold, refunded by provider
const PUBLIC_URL = process.env.PUBLIC_URL || 'http://localhost:5173';

/**
 * How long a freshly-issued hosted checkout blocks a second one.
 *
 * Opening two hosted pages is not a harmless double-click: each completed page
 * creates its OWN recurring subscription at the provider, and the venue's row
 * can only hold one token — so the other one bills every month with nothing in
 * the app able to cancel it.
 *
 * Short and bounded on purpose. A venue that abandons the provider page must be
 * able to try again quickly — blocking until something clears the row is what
 * trapped venues before (see the ALREADY_SUBSCRIBED comment below), and making
 * someone wait out a long lock is its own bad experience.
 *
 * This is the first line, not the only one: the duplicate-token guard in
 * routes/subscriptionWebhooks.js catches a second live subscription whenever it
 * appears, however long the gap was. So this window only has to be wide enough
 * to absorb the common case — an impatient venue clicking Start again while the
 * provider page is still open.
 */
const CHECKOUT_LOCK_MS = 5 * 60 * 1000;

function requireProviderConfigured(req, res, next) {
  const provider = getProvider();
  // Each provider's isConfigured() knows its own requirements (Paystack needs
  // a plan code, Stripe a price id, PayFast merchant credentials) — no
  // provider-specific env checks belong here.
  if (!provider.isConfigured()) {
    return res.status(503).json({
      error: 'Subscription billing is not configured on the server.',
      code: 'SUBSCRIPTION_NOT_CONFIGURED',
    });
  }
  req.subscriptionProvider = provider;
  next();
}

function getPlanCode() {
  return process.env.SUBSCRIPTION_PLAN_CODE || process.env.PAYSTACK_PLAN_CODE;
}

// ── GET /api/subscriptions/me ───────────────────────────────────────────────
router.get('/me', authMiddleware, (req, res) => {
  // Which processor the venue is actually sent to. The billing page used to
  // hardcode "Paystack" in its copy, which kept telling venues their card was
  // going somewhere it wasn't after the provider switched — the one claim on
  // that page a venue has no way to check for themselves.
  // Always string-or-null, never undefined: an omitted key would silently fall
  // back to the client's default label rather than showing it has no answer.
  const providerName = (() => {
    try { return getProvider().name || null; } catch { return null; }
  })();

  const sub = db.getSubscription(req.venue.code);
  if (!sub) {
    return res.json({
      status: 'none',
      venueCode: req.venue.code,
      trialDays: trialDays(),
      amountZar: SUBSCRIPTION_AMOUNT_ZAR,
      provider: providerName,
    });
  }
  // Report the EFFECTIVE status, not the stored flag. A subscription whose
  // trial or paid period lapsed keeps `trialing`/`active` in the database
  // forever — only checkVenueSubscription knows it has run out. Echoing the
  // raw flag left the billing page insisting the venue was on a free trial
  // that ended months ago, with no way to re-subscribe.
  const { ok, status: effectiveStatus } = checkVenueSubscription(sub.venueCode);

  res.json({
    status: effectiveStatus,
    storedStatus: sub.status,
    entitled: ok,
    trialEndsAt: sub.trialEndsAt,
    currentPeriodEnd: sub.currentPeriodEnd,
    cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
    venueCode: sub.venueCode,
    trialDays: trialDays(),
    amountZar: SUBSCRIPTION_AMOUNT_ZAR,
    provider: providerName,
  });
});

// ── POST /api/subscriptions/start ───────────────────────────────────────────
router.post('/start', authMiddleware, requireProviderConfigured, async (req, res) => {
  try {
    const venue = req.venue;
    const provider = req.subscriptionProvider;

    const existing = db.getSubscription(venue.code);
    // Block only a subscription that is STILL ENTITLED. Testing the stored
    // flag alone trapped venues whose trial had long since lapsed: the row
    // stays 'trialing' forever, so every attempt to subscribe again was
    // rejected as ALREADY_SUBSCRIBED while the venue was being told its trial
    // had ended. Nothing could clear it from the app.
    const stillEntitled = existing ? checkVenueSubscription(venue.code).ok : false;
    if (existing && stillEntitled && (existing.status === 'trialing' || existing.status === 'active')) {
      return res.status(400).json({
        error: 'This venue already has an active subscription.',
        code: 'ALREADY_SUBSCRIBED',
      });
    }

    // A checkout already in flight blocks a second one. Without this the venue
    // can open two hosted pages, complete both, and end up with two recurring
    // subscriptions at the provider — while `subscriptions` (one row per venue)
    // keeps only the last token, leaving the other billing forever with nothing
    // in the app able to cancel it.
    const openCheckout = db.getOpenSubscriptionCheckout(venue.code);
    if (openCheckout && Date.now() - openCheckout.createdAt < CHECKOUT_LOCK_MS) {
      return res.status(409).json({
        error: 'A checkout is already open for this venue. Finish it, or wait a few minutes and try again.',
        code: 'CHECKOUT_IN_PROGRESS',
        retryAfterMs: CHECKOUT_LOCK_MS - (Date.now() - openCheckout.createdAt),
      });
    }

    const { providerCustomerId } = await provider.createCustomer({
      email: venue.owner.email,
      firstName: venue.name,
      metadata: { venueCode: venue.code, venueName: venue.name },
    });

    const reference = `vbsub_${venue.code}_${Date.now()}`;
    const callbackUrl = `${PUBLIC_URL}/venue/billing/complete?reference=${encodeURIComponent(reference)}`;

    const init = await provider.initCardCapture({
      email: venue.owner.email,
      amountZar: AUTH_CHARGE_ZAR,
      reference,
      callbackUrl,
      metadata: { venueCode: venue.code, purpose: 'subscription_authorization' },
    });

    // Ledger first: the subscriptions row keeps only the newest reference, so
    // this is the only record that an earlier checkout ever existed. An ITN for
    // a superseded checkout still resolves through it.
    db.recordSubscriptionCheckout({ reference, venueCode: venue.code });
    db.supersedeOpenSubscriptionCheckouts(venue.code, reference);

    db.upsertSubscription({
      venueCode: venue.code,
      providerCustomerId,
      status: 'incomplete',
      paystackInitReference: reference,
    });

    res.json({
      authorizationUrl: init.authorizationUrl,
      reference: init.reference,
      amountZar: SUBSCRIPTION_AMOUNT_ZAR,
      trialDays: trialDays(),
    });
  } catch (err) {
    console.error('[SUB] /start failed:', err.message, err.paystack);
    res.status(502).json({ error: 'Could not start subscription', code: 'SUBSCRIPTION_START_FAILED' });
  }
});

// ── POST /api/subscriptions/complete ────────────────────────────────────────
router.post('/complete', authMiddleware, requireProviderConfigured, async (req, res) => {
  const reference = typeof req.body?.reference === 'string' ? req.body.reference : '';
  if (!reference) {
    return res.status(400).json({ error: 'reference required', code: 'MISSING_REFERENCE' });
  }

  try {
    const provider = req.subscriptionProvider;
    const pendingSub = db.getSubscriptionByInitReference(reference);
    if (!pendingSub) {
      return res.status(404).json({ error: 'Unknown transaction reference', code: 'UNKNOWN_REFERENCE' });
    }
    if (pendingSub.venueCode !== req.venue.code) {
      return res.status(403).json({ error: 'This reference belongs to another venue', code: 'REFERENCE_MISMATCH' });
    }

    // Idempotency — already set up
    if (pendingSub.status === 'trialing' || pendingSub.status === 'active') {
      return res.json({ status: pendingSub.status, alreadyComplete: true });
    }

    // Webhook-activated providers (PayFast): there is no pre-webhook
    // verification endpoint — the fully verified ITN is what confirms the
    // subscription (see routes/subscriptionWebhooks.js).
    if (provider.activationVia === 'webhook') {
      // A FREE-TRIAL checkout moves R0.00 — the hosted page only tokenizes the
      // card. There is no payment to confirm, so making the venue wait on an
      // inbound webhook before it can use anything buys no safety and costs it
      // the entire first impression: provider ITNs normally land in seconds,
      // but "seconds" is not a guarantee anyone can offer, and a venue that has
      // just signed up should not be staring at a spinner.
      //
      // So the trial starts now and the ITN confirms it afterwards. The worst
      // case is a venue that abandons the hosted page and returns here anyway,
      // getting a trial without a tokenized card — it costs nothing, expires on
      // its own, and the missing ITN is visible in the checkout ledger.
      //
      // A PAID activation is different in kind: real money has to have moved
      // before service starts, so it still waits for the verified ITN.
      if (trialDays() > 0) {
        const trialEndsAt = Date.now() + trialDays() * 24 * 60 * 60 * 1000;
        db.upsertSubscription({
          ...pendingSub,
          status: 'trialing',
          trialEndsAt,
          currentPeriodEnd: trialEndsAt,
          // providerSubscriptionId stays unset ON PURPOSE. It is what tells the
          // webhook this subscription has never been confirmed, so the ITN is
          // still handled as the activation (storing the real provider token
          // and sending the trial-started email) rather than as a renewal.
        });
        return res.json({ status: 'trialing', trialEndsAt, pendingConfirmation: true });
      }

      return res.status(202).json({
        status: 'pending_activation',
        message: 'Waiting for payment confirmation from the provider.',
      });
    }

    const verification = await provider.verifyCardCapture(reference);
    if (!verification.verified) {
      return res.status(400).json({ error: 'Payment authorisation failed', code: 'AUTH_FAILED' });
    }
    if (!verification.reusableAuthorization) {
      return res.status(400).json({ error: 'Card cannot be saved for recurring billing', code: 'CARD_NOT_REUSABLE' });
    }

    const trialEndsAt = Date.now() + trialDays() * 24 * 60 * 60 * 1000;

    const subscription = await provider.createSubscription({
      providerCustomerId: pendingSub.providerCustomerId,
      planCode: getPlanCode(),
      authorization: verification.reusableAuthorization,
      startDate: trialEndsAt,
    });

    db.upsertSubscription({
      venueCode: pendingSub.venueCode,
      providerCustomerId: pendingSub.providerCustomerId,
      providerSubscriptionId: subscription.providerSubscriptionId,
      status: 'trialing',
      trialEndsAt,
      currentPeriodEnd: trialEndsAt,
      paystackEmailToken: subscription.cancelToken,
      paystackAuthorizationCode: verification.reusableAuthorization,
      paystackInitReference: reference,
    });

    if (req.venue.owner?.email) {
      try {
        await sendTrialStartedEmail(req.venue.owner.email, {
          venueName: req.venue.name,
          trialEndsAt,
          amountZar: SUBSCRIPTION_AMOUNT_ZAR,
        });
      } catch (e) {
        console.warn('[SUB] trial-started email failed:', e.message);
      }
    }

    res.json({ status: 'trialing', trialEndsAt });
  } catch (err) {
    console.error('[SUB] /complete failed:', err.message, err.paystack);
    res.status(502).json({ error: 'Could not complete subscription setup', code: 'SUBSCRIPTION_COMPLETE_FAILED' });
  }
});

// ── POST /api/subscriptions/manage-link ─────────────────────────────────────
router.post('/manage-link', authMiddleware, requireProviderConfigured, async (req, res) => {
  try {
    const sub = db.getSubscription(req.venue.code);
    if (!sub || !sub.providerSubscriptionId) {
      return res.status(404).json({ error: 'No subscription found', code: 'NO_SUBSCRIPTION' });
    }

    const { link } = await req.subscriptionProvider.getManageLink({
      providerSubscriptionId: sub.providerSubscriptionId,
    });
    res.json({ link });
  } catch (err) {
    // Providers without a hosted manage surface (PayFast) are a normal case,
    // not a failure — tell the client so it can show its fallback copy.
    if (err.code === 'PROVIDER_NO_MANAGE_LINK') {
      return res.status(404).json({
        error: 'This billing provider has no hosted management page.',
        code: 'NO_MANAGE_LINK',
      });
    }
    console.error('[SUB] /manage-link failed:', err.message, err.paystack);
    res.status(502).json({ error: 'Could not generate manage link', code: 'SUBSCRIPTION_LINK_FAILED' });
  }
});

// ── POST /api/subscriptions/cancel ──────────────────────────────────────────
router.post('/cancel', authMiddleware, requireProviderConfigured, async (req, res) => {
  try {
    const sub = db.getSubscription(req.venue.code);
    if (!sub || !sub.providerSubscriptionId) {
      return res.status(404).json({ error: 'No cancellable subscription found', code: 'NO_SUBSCRIPTION' });
    }

    await req.subscriptionProvider.cancel({
      providerSubscriptionId: sub.providerSubscriptionId,
      cancelToken: sub.paystackEmailToken,
    });

    db.upsertSubscription({
      ...sub,
      status: 'canceled',
      cancelAtPeriodEnd: false,
    });

    res.json({ ok: true, status: 'canceled' });
  } catch (err) {
    console.error('[SUB] /cancel failed:', err.message, err.paystack);

    // A subscription the ACTIVE provider cannot address — typically a record
    // created under a previous provider, or one whose activation event never
    // arrived so we only ever held our own reference. We must not mark it
    // canceled locally: the other provider may still be charging the card, and
    // showing "canceled" while money keeps leaving is the worst outcome. Say
    // exactly that instead of a bare failure, so the venue knows the next step
    // is elsewhere rather than retrying a button that can never work.
    if (err.code === 'PROVIDER_CANCEL_UNADDRESSABLE') {
      return res.status(409).json({
        error:
          'This subscription was set up with a different payment provider, so we cannot cancel it '
          + 'automatically. Contact support and we will close it off for you — you will not be charged by Speeldit in the meantime.',
        code: 'SUBSCRIPTION_CANCEL_UNADDRESSABLE',
      });
    }

    res.status(502).json({ error: 'Could not cancel subscription', code: 'SUBSCRIPTION_CANCEL_FAILED' });
  }
});

module.exports = router;
