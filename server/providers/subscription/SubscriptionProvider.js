/**
 * Abstract subscription provider interface.
 *
 * Wraps a billing service that can capture a card, create a recurring
 * subscription with a free trial, generate a hosted "manage subscription"
 * link, cancel on demand, and verify webhook signatures. Routes depend on
 * this interface, not on a specific vendor (Paystack, Peach Payments,
 * Ozow Recurring, Stitch, etc.), so swapping billing services is an env
 * var + new implementation — no changes to routes.
 *
 * Normalized webhook event shape returned by `normalizeWebhookEvent`:
 * {
 *   kind: 'subscription_activated' | 'subscription_canceled' | 'charge_succeeded' | 'payment_failed' | 'unhandled',
 *   providerSubscriptionId?: string,
 *   providerCustomerId?: string,
 *   nextPaymentDate?: number,         // ms epoch
 *   rawEvent?: string,                // for logs
 * }
 */

class SubscriptionProvider {
  /** @returns {string} Provider identifier, e.g. "paystack". */
  get name() {
    throw new Error('SubscriptionProvider.name must be overridden');
  }

  /** @returns {boolean} Whether the provider has the env vars it needs. */
  isConfigured() {
    throw new Error('SubscriptionProvider.isConfigured must be overridden');
  }

  /**
   * Create (or fetch) a customer on the provider.
   * @param {{email:string, firstName?:string, lastName?:string, phone?:string, metadata?:object}} args
   * @returns {Promise<{providerCustomerId:string, raw:object}>}
   */
  // eslint-disable-next-line no-unused-vars
  async createCustomer(args) {
    throw new Error('SubscriptionProvider.createCustomer must be overridden');
  }

  /**
   * Start a hosted card-capture flow for subscription authorization.
   * Providers typically charge a small amount (refunded) to tokenize the card.
   * @param {{email:string, amountZar:number, reference:string, callbackUrl:string, metadata?:object}} args
   * @returns {Promise<{authorizationUrl:string, reference:string, raw:object}>}
   */
  // eslint-disable-next-line no-unused-vars
  async initCardCapture(args) {
    throw new Error('SubscriptionProvider.initCardCapture must be overridden');
  }

  /**
   * Verify a completed card-capture transaction by reference.
   * @param {string} reference
   * @returns {Promise<{verified:boolean, reusableAuthorization?:string, raw:object}>}
   *   reusableAuthorization is an opaque provider token we store to drive
   *   future subscription invoices; empty/undefined = card not reusable.
   */
  // eslint-disable-next-line no-unused-vars
  async verifyCardCapture(reference) {
    throw new Error('SubscriptionProvider.verifyCardCapture must be overridden');
  }

  /**
   * Create the recurring subscription now that we have a reusable authorization.
   * Providers that support a delayed first charge (for trials) accept startDate.
   * @param {{providerCustomerId:string, planCode:string, authorization:string, startDate?:number}} args
   * @returns {Promise<{providerSubscriptionId:string, cancelToken?:string, raw:object}>}
   *   cancelToken is any extra credential the provider needs to cancel later
   *   (Paystack: email_token). Store it alongside the subscription.
   */
  // eslint-disable-next-line no-unused-vars
  async createSubscription(args) {
    throw new Error('SubscriptionProvider.createSubscription must be overridden');
  }

  /**
   * Return a short-lived, hosted URL the customer can use to manage their
   * subscription (update card, cancel). Providers without such a surface
   * should throw so the UI can fall back to a "contact support" flow.
   * @param {{providerSubscriptionId:string}} args
   * @returns {Promise<{link:string}>}
   */
  // eslint-disable-next-line no-unused-vars
  async getManageLink(args) {
    throw new Error('SubscriptionProvider.getManageLink must be overridden');
  }

  /**
   * Cancel the subscription immediately. Implementations must be idempotent
   * — calling cancel on an already-canceled sub must resolve, not throw.
   * @param {{providerSubscriptionId:string, cancelToken?:string}} args
   * @returns {Promise<void>}
   */
  // eslint-disable-next-line no-unused-vars
  async cancel(args) {
    throw new Error('SubscriptionProvider.cancel must be overridden');
  }

  /**
   * Verify the raw body + signature header of an incoming webhook.
   * @param {Buffer} rawBody
   * @param {object} headers  Lowercased Express req.headers object
   * @returns {boolean}
   */
  // eslint-disable-next-line no-unused-vars
  verifyWebhook(rawBody, headers) {
    throw new Error('SubscriptionProvider.verifyWebhook must be overridden');
  }

  /**
   * Translate a provider-specific webhook payload into the normalized shape
   * documented at the top of this file. Unknown events return kind:'unhandled'.
   * @param {object} payload
   * @returns {{kind:string, providerSubscriptionId?:string, providerCustomerId?:string, nextPaymentDate?:number, rawEvent?:string}}
   */
  // eslint-disable-next-line no-unused-vars
  normalizeWebhookEvent(payload) {
    throw new Error('SubscriptionProvider.normalizeWebhookEvent must be overridden');
  }
}

module.exports = SubscriptionProvider;
