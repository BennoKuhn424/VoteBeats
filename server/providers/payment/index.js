/**
 * Patron-payment provider factory.
 *
 * Resolves the active provider from `process.env.PATRON_PAYMENT_PROVIDER`
 * (default: "yoco") and caches the instance. Unknown values fall back to
 * Yoco with a console warning — mirrors the search + subscription factories.
 *
 * Add a new checkout provider by dropping in a class that extends
 * PatronPaymentProvider and registering it in buildProvider().
 */

const YocoPatronPaymentProvider = require('./YocoPatronPaymentProvider');

let cached = null;

function buildProvider() {
  const name = (process.env.PATRON_PAYMENT_PROVIDER || 'yoco').trim().toLowerCase();
  switch (name) {
    case 'yoco':
      return new YocoPatronPaymentProvider();
    default:
      console.warn(
        `[providers] Unknown PATRON_PAYMENT_PROVIDER="${name}" — falling back to "yoco".`
      );
      return new YocoPatronPaymentProvider();
  }
}

/** @returns {import('./PatronPaymentProvider')} */
function getProvider() {
  if (!cached) cached = buildProvider();
  return cached;
}

function _resetProviderForTests() {
  cached = null;
}

module.exports = { getProvider, _resetProviderForTests };
