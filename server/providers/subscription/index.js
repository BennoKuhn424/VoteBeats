/**
 * Subscription provider factory.
 *
 * Resolves the active provider from `process.env.SUBSCRIPTION_PROVIDER`
 * (default: "paystack") and caches the instance. Unknown values fall back
 * to Paystack with a console warning — mirrors the search-provider pattern
 * in ../index.js so the server keeps running while misconfiguration is
 * visible in logs.
 *
 * Add a new billing provider by dropping in a class that extends
 * SubscriptionProvider and registering it in buildProvider().
 */

const PaystackSubscriptionProvider = require('./PaystackSubscriptionProvider');

let cached = null;

function buildProvider() {
  const name = (process.env.SUBSCRIPTION_PROVIDER || 'paystack').trim().toLowerCase();
  switch (name) {
    case 'paystack':
      return new PaystackSubscriptionProvider();
    default:
      console.warn(
        `[providers] Unknown SUBSCRIPTION_PROVIDER="${name}" — falling back to "paystack".`
      );
      return new PaystackSubscriptionProvider();
  }
}

/** @returns {import('./SubscriptionProvider')} */
function getProvider() {
  if (!cached) cached = buildProvider();
  return cached;
}

function _resetProviderForTests() {
  cached = null;
}

module.exports = { getProvider, _resetProviderForTests };
