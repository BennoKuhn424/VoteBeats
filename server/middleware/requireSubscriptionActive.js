const db = require('../utils/database');

const ACTIVE_STATUSES = new Set(['trialing', 'active']);

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

  const sub = db.getSubscription(req.venue.code);
  const enforcement = (process.env.SUBSCRIPTION_ENFORCEMENT || 'lenient').toLowerCase();

  if (!sub || sub.status === 'none') {
    if (enforcement === 'strict') {
      return res.status(402).json({
        error: 'Subscription required',
        code: 'SUBSCRIPTION_REQUIRED',
        subscriptionStatus: 'none',
      });
    }
    return next();
  }

  if (ACTIVE_STATUSES.has(sub.status)) {
    return next();
  }

  // past_due, canceled, incomplete — block.
  return res.status(402).json({
    error: `Subscription is ${sub.status}. Please update your payment details.`,
    code: 'SUBSCRIPTION_INACTIVE',
    subscriptionStatus: sub.status,
  });
}

module.exports = requireSubscriptionActive;
