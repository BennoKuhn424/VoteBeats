const crypto = require('crypto');

const BASE_URL = 'https://api.paystack.co';

function getSecret() {
  const key = process.env.PAYSTACK_SECRET_KEY;
  if (!key) throw new Error('PAYSTACK_SECRET_KEY not set');
  return key;
}

async function paystackRequest(method, path, body) {
  const url = `${BASE_URL}${path}`;
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${getSecret()}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  let data;
  try {
    data = await res.json();
  } catch {
    data = null;
  }

  if (!res.ok || !data?.status) {
    const message = data?.message || `Paystack ${method} ${path} failed (${res.status})`;
    const err = new Error(message);
    err.status = res.status;
    err.paystack = data;
    throw err;
  }

  return data.data;
}

/**
 * Create (or fetch) a customer on Paystack. Returns { customer_code, id, ... }.
 * If the customer already exists for this email, Paystack returns the existing one.
 */
async function createCustomer({ email, firstName, lastName, phone, metadata }) {
  return paystackRequest('POST', '/customer', {
    email,
    first_name: firstName,
    last_name: lastName,
    phone,
    metadata,
  });
}

/**
 * Initialize a Paystack transaction to capture a card for subscription.
 * We use a R1 auth charge (not the full R599), then invoices pick up from day 14.
 *
 * Returns { authorization_url, access_code, reference }.
 * Redirect the user to `authorization_url` to complete the card capture.
 */
async function initializeTransaction({
  email,
  amountZar, // rand, not kobo
  reference,
  callbackUrl,
  metadata,
  channels, // optional string[] of channels to allow
}) {
  return paystackRequest('POST', '/transaction/initialize', {
    email,
    amount: Math.round(Number(amountZar) * 100), // Paystack expects amount in kobo (cents)
    currency: 'ZAR',
    reference,
    callback_url: callbackUrl,
    metadata,
    channels,
  });
}

/** Verify a completed transaction by reference (server-side double-check after callback). */
async function verifyTransaction(reference) {
  return paystackRequest('GET', `/transaction/verify/${encodeURIComponent(reference)}`);
}

/**
 * Create a subscription on an existing plan for a customer. Paystack will charge
 * the customer's saved authorization on the schedule defined by the plan.
 *
 * start_date controls when the first real invoice is generated — we set it to
 * trial_end to implement the 14-day free trial (no charge until day 14).
 */
async function createSubscription({ customerCode, planCode, authorizationCode, startDate }) {
  return paystackRequest('POST', '/subscription', {
    customer: customerCode,
    plan: planCode,
    authorization: authorizationCode,
    start_date: startDate ? new Date(startDate).toISOString() : undefined,
  });
}

/** Fetch a subscription by code or id. */
async function fetchSubscription(subscriptionCodeOrId) {
  return paystackRequest('GET', `/subscription/${encodeURIComponent(subscriptionCodeOrId)}`);
}

/**
 * Generate a one-time link the customer can use to cancel/update their card.
 * Paystack returns a hosted "manage subscription" link keyed by subscription code + email_token.
 */
async function generateManageLink(subscriptionCode) {
  return paystackRequest('GET', `/subscription/${encodeURIComponent(subscriptionCode)}/manage/link`);
}

/**
 * Disable (cancel) a subscription. Requires both the subscription code and the
 * email_token issued when the subscription was created. We store email_token on
 * the subscription record so we can disable on demand.
 */
async function disableSubscription({ code, emailToken }) {
  return paystackRequest('POST', '/subscription/disable', {
    code,
    token: emailToken,
  });
}

/**
 * Verify the x-paystack-signature header on an incoming webhook.
 * Paystack signs the raw request body with HMAC-SHA512 using the secret key.
 * https://paystack.com/docs/payments/webhooks/#verify-event-origin
 */
function verifyWebhookSignature(rawBody, signatureHeader) {
  const secret = process.env.PAYSTACK_WEBHOOK_SECRET || process.env.PAYSTACK_SECRET_KEY;
  if (!secret || !signatureHeader) return false;

  const bodyBuf = Buffer.isBuffer(rawBody)
    ? rawBody
    : Buffer.from(typeof rawBody === 'string' ? rawBody : JSON.stringify(rawBody || {}), 'utf8');

  const expected = crypto.createHmac('sha512', secret).update(bodyBuf).digest('hex');

  try {
    return crypto.timingSafeEqual(
      Buffer.from(expected, 'hex'),
      Buffer.from(String(signatureHeader), 'hex')
    );
  } catch {
    return false;
  }
}

module.exports = {
  createCustomer,
  initializeTransaction,
  verifyTransaction,
  createSubscription,
  fetchSubscription,
  generateManageLink,
  disableSubscription,
  verifyWebhookSignature,
};
