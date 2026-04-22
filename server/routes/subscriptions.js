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
const { sendTrialStartedEmail } = require('../utils/email');

const router = express.Router();

const TRIAL_DAYS = parseInt(process.env.SUBSCRIPTION_TRIAL_DAYS || process.env.PAYSTACK_TRIAL_DAYS, 10) || 14;
const SUBSCRIPTION_AMOUNT_ZAR = parseInt(
  process.env.SUBSCRIPTION_AMOUNT_ZAR || process.env.PAYSTACK_SUBSCRIPTION_AMOUNT_ZAR,
  10,
) || 599;
const AUTH_CHARGE_ZAR = 1; // Small authorisation hold, refunded by provider
const PUBLIC_URL = process.env.PUBLIC_URL || 'http://localhost:5173';

function requireProviderConfigured(req, res, next) {
  const provider = getProvider();
  if (!provider.isConfigured() || !process.env.SUBSCRIPTION_PLAN_CODE && !process.env.PAYSTACK_PLAN_CODE) {
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
  const sub = db.getSubscription(req.venue.code);
  if (!sub) {
    return res.json({
      status: 'none',
      venueCode: req.venue.code,
      trialDays: TRIAL_DAYS,
      amountZar: SUBSCRIPTION_AMOUNT_ZAR,
    });
  }
  res.json({
    status: sub.status,
    trialEndsAt: sub.trialEndsAt,
    currentPeriodEnd: sub.currentPeriodEnd,
    cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
    venueCode: sub.venueCode,
    trialDays: TRIAL_DAYS,
    amountZar: SUBSCRIPTION_AMOUNT_ZAR,
  });
});

// ── POST /api/subscriptions/start ───────────────────────────────────────────
router.post('/start', authMiddleware, requireProviderConfigured, async (req, res) => {
  try {
    const venue = req.venue;
    const provider = req.subscriptionProvider;

    const existing = db.getSubscription(venue.code);
    if (existing && (existing.status === 'trialing' || existing.status === 'active')) {
      return res.status(400).json({
        error: 'This venue already has an active subscription.',
        code: 'ALREADY_SUBSCRIBED',
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
      trialDays: TRIAL_DAYS,
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

    const verification = await provider.verifyCardCapture(reference);
    if (!verification.verified) {
      return res.status(400).json({ error: 'Payment authorisation failed', code: 'AUTH_FAILED' });
    }
    if (!verification.reusableAuthorization) {
      return res.status(400).json({ error: 'Card cannot be saved for recurring billing', code: 'CARD_NOT_REUSABLE' });
    }

    const trialEndsAt = Date.now() + TRIAL_DAYS * 24 * 60 * 60 * 1000;

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
    res.status(502).json({ error: 'Could not cancel subscription', code: 'SUBSCRIPTION_CANCEL_FAILED' });
  }
});

module.exports = router;
