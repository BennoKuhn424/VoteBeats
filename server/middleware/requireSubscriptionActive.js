const db = require('../utils/database');

const ACTIVE_STATUSES = new Set(['trialing', 'active']);

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
