const crypto = require('crypto');

/**
 * Minimal Stripe REST client + webhook signature verification.
 *
 * Deliberately fetch-based (no `stripe` npm dependency) to mirror how
 * utils/yoco.js and utils/paystack.js talk to their vendors — one less
 * package to audit, and the two Stripe providers only need a handful of
 * endpoints.
 *
 * Env:
 *   STRIPE_SECRET_KEY                  sk_test_... / sk_live_...
 *   STRIPE_WEBHOOK_SECRET              whsec_... for the patron-payment endpoint
 *   STRIPE_SUBSCRIPTION_WEBHOOK_SECRET whsec_... for the subscription endpoint
 *                                      (falls back to STRIPE_WEBHOOK_SECRET)
 */

const API_BASE = 'https://api.stripe.com';

/**
 * Flatten a nested object into Stripe's bracket-style form fields:
 *   { line_items: [{ price_data: { currency: 'usd' } }] }
 *   → [['line_items[0][price_data][currency]', 'usd']]
 * null/undefined values are dropped.
 */
function formEncode(obj, prefix = '') {
  const pairs = [];
  for (const [key, value] of Object.entries(obj || {})) {
    if (value === undefined || value === null) continue;
    const name = prefix ? `${prefix}[${key}]` : key;
    if (Array.isArray(value)) {
      value.forEach((item, i) => {
        if (item !== null && typeof item === 'object') {
          pairs.push(...formEncode(item, `${name}[${i}]`));
        } else if (item !== undefined && item !== null) {
          pairs.push([`${name}[${i}]`, String(item)]);
        }
      });
    } else if (typeof value === 'object') {
      pairs.push(...formEncode(value, name));
    } else {
      pairs.push([name, String(value)]);
    }
  }
  return pairs;
}

/**
 * Call the Stripe API. POST params are form-encoded (Stripe does not accept
 * JSON bodies); GET params become the query string. Throws an Error with
 * `.status` and `.code` on non-2xx responses so providers can translate.
 */
async function stripeRequest(method, path, params) {
  const secret = process.env.STRIPE_SECRET_KEY;
  if (!secret) {
    const err = new Error('STRIPE_SECRET_KEY not set');
    err.code = 'PROVIDER_NOT_CONFIGURED';
    throw err;
  }

  let url = `${API_BASE}${path}`;
  const opts = { method, headers: { Authorization: `Bearer ${secret}` } };

  if (params && method === 'GET') {
    const qs = new URLSearchParams();
    for (const [k, v] of formEncode(params)) qs.append(k, v);
    url += `?${qs.toString()}`;
  } else if (params) {
    const body = new URLSearchParams();
    for (const [k, v] of formEncode(params)) body.append(k, v);
    opts.headers['Content-Type'] = 'application/x-www-form-urlencoded';
    opts.body = body.toString();
  }

  const res = await fetch(url, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data?.error?.message || `Stripe request failed (${res.status})`);
    err.status = res.status;
    err.code = data?.error?.code || 'STRIPE_REQUEST_FAILED';
    throw err;
  }
  return data;
}

/**
 * Verify a Stripe webhook (Stripe-Signature: t=...,v1=...).
 * HMAC-SHA256 over `${t}.${rawBody}` with the endpoint's whsec_ secret
 * (used as-is — Stripe secrets are not base64-decoded). 5-minute replay
 * tolerance, timing-safe compare, multiple v1 signatures supported
 * (present during secret rotation).
 */
function verifyStripeWebhookSignature(rawBodyBuf, headers, secret) {
  if (!secret) {
    console.warn('Webhook: Stripe webhook secret is not configured');
    return false;
  }
  const header = headers['stripe-signature'];
  if (!header) {
    console.warn('Webhook: missing stripe-signature header');
    return false;
  }

  let timestamp = null;
  const signatures = [];
  for (const part of String(header).split(',')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const key = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (key === 't') timestamp = value;
    else if (key === 'v1') signatures.push(value);
  }
  if (!timestamp || signatures.length === 0) return false;

  const tsSec = parseInt(timestamp, 10);
  if (!Number.isFinite(tsSec) || Math.abs(Date.now() / 1000 - tsSec) > 300) {
    console.warn('Webhook: Stripe signature timestamp outside 5-minute window');
    return false;
  }

  const rawStr = Buffer.isBuffer(rawBodyBuf) ? rawBodyBuf.toString('utf8') : String(rawBodyBuf || '');
  const expected = crypto
    .createHmac('sha256', secret)
    .update(`${timestamp}.${rawStr}`)
    .digest('hex');
  const expBuf = Buffer.from(expected, 'hex');

  for (const sig of signatures) {
    try {
      const sigBuf = Buffer.from(sig, 'hex');
      if (sigBuf.length === expBuf.length && crypto.timingSafeEqual(expBuf, sigBuf)) return true;
    } catch (_) {
      /* malformed hex — try next */
    }
  }
  console.warn('Webhook: Stripe signature verification failed');
  return false;
}

module.exports = { stripeRequest, verifyStripeWebhookSignature, formEncode };
