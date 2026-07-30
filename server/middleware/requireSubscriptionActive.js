const db = require('../utils/database');

const ACTIVE_STATUSES = new Set(['trialing', 'active']);

/**
 * Days past currentPeriodEnd before an active/trialing subscription stops
 * counting as paid. The status flag alone is not enough: if the provider's
 * renewal webhooks stop arriving (endpoint broken, provider outage, card
 * cancelled at the bank with no notification), a sub would otherwise stay
 * 'active' forever — service delivered, nothing paid. The grace window keeps
 * a briefly-late webhook from blocking a paying venue, while a genuinely
 * unpaid one expires on its own.
 */
function graceDays() {
  const n = parseInt(process.env.SUBSCRIPTION_GRACE_DAYS, 10);
  return Number.isFinite(n) && n >= 0 ? n : 5;
}

// This runs on every gated request, so a malformed row must not log on every
// one of them. One line per venue per process is enough to find it.
const warnedMissingPaidThrough = new Set();

function warnMissingPaidThrough(venueCode, status) {
  if (warnedMissingPaidThrough.has(venueCode)) return;
  warnedMissingPaidThrough.add(venueCode);
  console.error(JSON.stringify({
    t: new Date().toISOString(),
    msg: 'subscription-no-paid-through-date',
    venueCode,
    status,
    detail:
      'active/trialing with neither currentPeriodEnd nor trialEndsAt — cannot prove this venue is paid up. '
      + 'Service is still being delivered; check the provider dashboard and repair the row.',
  }));
}

/**
 * Returns the subscription status of a venue and whether it's allowed to
 * operate. Centralised so the venue-auth guard and the patron-facing guard
 * stay in sync.
 *
 * Returns { ok: boolean, status: string, strict: boolean }.
 */
function checkVenueSubscription(venueCode) {
  const sub = db.getSubscription(venueCode);
  const enforcement = (process.env.SUBSCRIPTION_ENFORCEMENT || 'lenient').toLowerCase();
  const strict = enforcement === 'strict';
  const status = sub?.status || 'none';

  if (!sub || status === 'none') {
    return { ok: !strict, status: 'none', strict };
  }

  // Paid-through check: an "active" flag whose paid period lapsed beyond the
  // grace window is treated as expired, not honoured on faith.
  if (ACTIVE_STATUSES.has(status)) {
    const graceMs = graceDays() * 24 * 60 * 60 * 1000;

    // Which date proves this venue is paid up? currentPeriodEnd is the real
    // one, but a subscription can legitimately sit in 'trialing' before any
    // renewal event has set it — then the trial end is the only deadline we
    // have. Checking currentPeriodEnd ALONE (the previous behaviour) meant a
    // trialing row with no currentPeriodEnd skipped the expiry check
    // completely and got free service forever, which is precisely what this
    // guard exists to prevent.
    const paidUntil = sub.currentPeriodEnd || sub.trialEndsAt || null;

    if (paidUntil) {
      if (Date.now() > paidUntil + graceMs) {
        return { ok: false, status: 'expired', strict };
      }
    } else {
      // Active/trialing with no paid-through date at all. Every provider sets
      // one on activation, so this means a malformed row rather than a normal
      // state — but it is NOT treated as expired, deliberately. This function
      // guards every request from every venue, so a rule that blocks on a
      // missing date would turn one bad write (or one provider that stopped
      // sending dates) into a total outage for everyone at once. That is a
      // worse failure than the free service it would prevent. Surface it
      // loudly instead and let a human decide.
      warnMissingPaidThrough(venueCode, status);
    }
  }

  return { ok: ACTIVE_STATUSES.has(status), status, strict };
}

/**
 * Allow venues that have an active/trialing subscription. Legacy venues without
 * a subscription record (status 'none') are grandfathered while
 * SUBSCRIPTION_ENFORCEMENT is not 'strict'. Flip SUBSCRIPTION_ENFORCEMENT=strict
 * once every active venue has been migrated to a Paystack subscription.
 *
 * Must run AFTER authMiddleware — expects req.venue to be populated.
 */
function requireSubscriptionActive(req, res, next) {
  if (!req.venue) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  const { ok, status } = checkVenueSubscription(req.venue.code);
  if (ok) return next();

  if (status === 'none') {
    return res.status(402).json({
      error: 'Subscription required',
      code: 'SUBSCRIPTION_REQUIRED',
      subscriptionStatus: 'none',
    });
  }
  return res.status(402).json({
    error: `Subscription is ${status}. Please update your payment details.`,
    code: 'SUBSCRIPTION_INACTIVE',
    subscriptionStatus: status,
  });
}

/**
 * Patron-side variant — gates the public /queue/:venueCode/* write routes on
 * the venue's subscription, reading venueCode from the URL param. Patrons
 * shouldn't see billing jargon, so the error copy is gentler.
 */
function requireVenueSubscriptionActive(req, res, next) {
  const venueCode = req.params?.venueCode;
  if (!venueCode) return next();

  const { ok, status } = checkVenueSubscription(venueCode);
  if (ok) return next();

  return res.status(402).json({
    error: 'This venue is not currently accepting requests.',
    code: 'VENUE_SUBSCRIPTION_INACTIVE',
    subscriptionStatus: status,
  });
}

module.exports = requireSubscriptionActive;
module.exports.checkVenueSubscription = checkVenueSubscription;
module.exports.requireVenueSubscriptionActive = requireVenueSubscriptionActive;
