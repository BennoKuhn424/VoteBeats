/**
 * Abstract patron-payment provider interface.
 *
 * Wraps a hosted-checkout service that lets a patron pay a small amount
 * (R5–R50) to request a song at a venue. The route creates a checkout,
 * redirects the patron, and later fulfills the request via webhook +
 * server-side verification.
 *
 * Routes depend on this interface, not on a specific vendor (Yoco,
 * Peach Checkout, Ozow, Stitch, Flutterwave, etc.), so swapping checkout
 * providers is an env var + new implementation — no route changes.
 *
 * Normalized webhook event shape returned by `normalizeWebhookEvent`:
 * {
 *   kind: 'payment_succeeded' | 'unhandled',
 *   checkoutId?: string,
 *   amountCents?: number,
 *   rawEvent?: string,
 * }
 */

class PatronPaymentProvider {
  /** @returns {string} Provider identifier, e.g. "yoco". */
  get name() {
    throw new Error('PatronPaymentProvider.name must be overridden');
  }

  /** @returns {boolean} Whether the provider has the env vars it needs. */
  isConfigured() {
    throw new Error('PatronPaymentProvider.isConfigured must be overridden');
  }

  /**
   * Create a hosted checkout. The patron is redirected to `redirectUrl`.
   * `checkoutId` is the provider's opaque id we use to look up the checkout
   * later (status polls, webhook correlation).
   * @param {{amountCents:number, currency?:string, successUrl:string, cancelUrl:string, failureUrl:string, metadata?:object}} args
   * @returns {Promise<{checkoutId:string, redirectUrl:string, raw:object}>}
   */
  // eslint-disable-next-line no-unused-vars
  async createCheckout(args) {
    throw new Error('PatronPaymentProvider.createCheckout must be overridden');
  }

  /**
   * Ask the provider whether a checkout completed. Used by both the
   * status-poll route and the webhook handler (defence in depth — never
   * trust a webhook payload alone).
   * @param {string} checkoutId
   * @returns {Promise<{verified:boolean, amountCents?:number|null}>}
   */
  // eslint-disable-next-line no-unused-vars
  async verifyCheckout(checkoutId) {
    throw new Error('PatronPaymentProvider.verifyCheckout must be overridden');
  }

  /**
   * Verify the raw body + signature headers of an incoming webhook.
   * Implementations that cannot verify (no secret configured) should
   * return true only if that's their documented development behaviour.
   * @param {Buffer} rawBody
   * @param {object} headers  Lowercased Express req.headers object
   * @returns {boolean}
   */
  // eslint-disable-next-line no-unused-vars
  verifyWebhook(rawBody, headers) {
    throw new Error('PatronPaymentProvider.verifyWebhook must be overridden');
  }

  /**
   * Translate a provider-specific webhook payload into the normalized shape
   * documented at the top of this file. Non-payment events return
   * kind:'unhandled' so the route can ack them without taking action.
   * @param {object} payload
   * @returns {{kind:string, checkoutId?:string, amountCents?:number, rawEvent?:string}}
   */
  // eslint-disable-next-line no-unused-vars
  normalizeWebhookEvent(payload) {
    throw new Error('PatronPaymentProvider.normalizeWebhookEvent must be overridden');
  }
}

module.exports = PatronPaymentProvider;
