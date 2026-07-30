const crypto = require('crypto');

/**
 * PayFast (by Network) helpers — signing, ITN verification, host selection.
 *
 * PayFast is structurally unlike Paystack/Stripe, so this module owns the
 * quirks and the provider class stays thin:
 *
 *  - Requests are signed with an MD5 hash over the URL-encoded, insertion-order
 *    parameter string with the passphrase appended — NOT an HMAC over a raw
 *    body. Encoding must match PayFast exactly: RFC1738 (spaces as '+', upper-
 *    case percent-encoding), and the signature covers fields in the order they
 *    are added.
 *  - The webhook (ITN) is form-encoded (application/x-www-form-urlencoded), and
 *    verification is layered: (1) recompute the signature, (2) confirm the
 *    source IP is a PayFast IP, (3) post the data back to PayFast /validate and
 *    require "VALID". This module provides (1) and (2); the server-to-server
 *    postback (3) is done in the provider so it can be mocked in tests.
 *
 * Env:
 *   PAYFAST_MERCHANT_ID
 *   PAYFAST_MERCHANT_KEY
 *   PAYFAST_PASSPHRASE          required for signing when set on the account
 *   PAYFAST_SANDBOX=true        use sandbox host + validate endpoint
 */

const LIVE_PROCESS_HOST = 'https://www.payfast.co.za';
const SANDBOX_PROCESS_HOST = 'https://sandbox.payfast.co.za';
const API_HOST = 'https://api.payfast.co.za';

// PayFast source IPs for ITN. Kept broad (CIDR) rather than exact IPs so the
// check survives PayFast rotating within their published ranges (see the
// dashboard "Whitelisting IP addresses" notice). Hostname reverse-lookup is the
// documented alternative; CIDR is simpler and offline-testable.
const PAYFAST_IP_RANGES = [
  '197.97.145.144/28',
  '41.74.179.192/27',
  '102.216.36.0/24',
  '102.216.36.128/25',
  '144.126.193.139/32',
  // AWS migration ranges announced on the dashboard (3.163.*.237).
  '3.163.232.0/21',
];

function isSandbox(env = process.env) {
  return String(env.PAYFAST_SANDBOX || '').trim().toLowerCase() === 'true';
}

/**
 * PayFast credentials, whitespace-stripped.
 *
 * Always read credentials through this. Values pasted into a hosting
 * dashboard routinely carry a leading or trailing space, and here that is
 * invisible and brutal: the space is signed (encoded as '+'), so PayFast
 * recomputes a different hash and rejects the checkout with
 * "Generated signature does not match submitted signature" — an error that
 * points at the signing code rather than at the stray character actually
 * causing it. Trimming once, centrally, removes the whole failure class.
 *
 * A passphrase of empty-string is normalised to undefined, because "" and
 * "not set" must behave identically — an empty passphrase must never be
 * appended to the signature string.
 */
function credentials(env = process.env) {
  const trim = (v) => (typeof v === 'string' ? v.trim() : v);
  const passphrase = trim(env.PAYFAST_PASSPHRASE);
  return {
    merchantId: trim(env.PAYFAST_MERCHANT_ID) || undefined,
    merchantKey: trim(env.PAYFAST_MERCHANT_KEY) || undefined,
    passphrase: passphrase || undefined,
  };
}

function processHost(env = process.env) {
  return isSandbox(env) ? SANDBOX_PROCESS_HOST : LIVE_PROCESS_HOST;
}

/**
 * RFC1738 encode a value the way PayFast expects: spaces become '+', and
 * percent-encoding is upper-case. encodeURIComponent gives lower-case hex and
 * '%20' for spaces, so we post-process.
 */
function pfEncode(value) {
  return encodeURIComponent(String(value))
    .replace(/%20/g, '+')
    .replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase())
    // encodeURIComponent already upper-cases its hex, but normalise anything else.
    .replace(/%[0-9a-f]{2}/g, (m) => m.toUpperCase());
}

/**
 * Build the signature over an ordered [key, value] list. Blank values are
 * skipped (PayFast excludes empty fields). The passphrase, when configured, is
 * appended as the final parameter before hashing.
 * @param {Array<[string,string]>} orderedPairs
 * @param {string} [passphrase]
 * @returns {string} 32-char lowercase MD5 hex
 */
function signParams(orderedPairs, passphrase) {
  const parts = [];
  for (const [k, v] of orderedPairs) {
    if (v === undefined || v === null || String(v) === '') continue;
    parts.push(`${k}=${pfEncode(v)}`);
  }
  if (passphrase) parts.push(`passphrase=${pfEncode(passphrase)}`);
  return crypto.createHash('md5').update(parts.join('&')).digest('hex');
}

/**
 * Verify an ITN payload's signature. PayFast posts a `signature` field computed
 * over all OTHER posted fields in the order received. We reconstruct from the
 * raw body to preserve that order (JSON/object key order is not guaranteed).
 * @param {Buffer|string} rawBody  the raw form-encoded ITN body
 * @param {string} [passphrase]
 * @returns {boolean}
 */
function verifyItnSignature(rawBody, passphrase) {
  const raw = Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : String(rawBody || '');
  const pairs = raw.split('&').map((kv) => {
    const i = kv.indexOf('=');
    return i === -1 ? [kv, ''] : [kv.slice(0, i), kv.slice(i + 1)];
  });

  let provided = '';
  const ordered = [];
  for (const [k, v] of pairs) {
    if (k === 'signature') { provided = v; continue; }
    ordered.push([k, v]);
  }
  if (!provided) return false;

  // The values in the raw body are already PayFast-encoded; rebuild the signed
  // string using them verbatim rather than re-encoding (double-encoding breaks
  // the match). Blank fields are excluded, same as signing.
  const parts = [];
  for (const [k, v] of ordered) {
    if (v === '') continue;
    parts.push(`${k}=${v}`);
  }
  if (passphrase) parts.push(`passphrase=${pfEncode(passphrase)}`);
  const expected = crypto.createHash('md5').update(parts.join('&')).digest('hex');

  const a = Buffer.from(expected);
  const b = Buffer.from(String(provided));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** Parse a form-encoded ITN body into a plain object. */
function parseItnBody(rawBody) {
  const raw = Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : String(rawBody || '');
  const out = {};
  for (const kv of raw.split('&')) {
    if (!kv) continue;
    const i = kv.indexOf('=');
    const k = i === -1 ? kv : kv.slice(0, i);
    const v = i === -1 ? '' : kv.slice(i + 1);
    out[decodeURIComponent(k)] = decodeURIComponent(v.replace(/\+/g, ' '));
  }
  return out;
}

/** ipv4 → 32-bit int, or null if not a plain IPv4. */
function ipToInt(ip) {
  const m = String(ip).trim().match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return null;
  const parts = m.slice(1).map(Number);
  if (parts.some((p) => p > 255)) return null;
  return ((parts[0] << 24) >>> 0) + (parts[1] << 16) + (parts[2] << 8) + parts[3];
}

/** Is `ip` inside any known PayFast range? IPv6 / unparseable → false. */
function isPayfastIp(ip, ranges = PAYFAST_IP_RANGES) {
  // Strip IPv4-mapped IPv6 prefix (::ffff:1.2.3.4) that Node may report.
  const clean = String(ip || '').replace(/^::ffff:/i, '');
  const ipInt = ipToInt(clean);
  if (ipInt === null) return false;
  for (const cidr of ranges) {
    const [base, bitsRaw] = cidr.split('/');
    const bits = parseInt(bitsRaw, 10);
    const baseInt = ipToInt(base);
    if (baseInt === null) continue;
    const mask = bits === 0 ? 0 : (~((1 << (32 - bits)) - 1)) >>> 0;
    if ((ipInt & mask) === (baseInt & mask)) return true;
  }
  return false;
}

/**
 * Server-to-server ITN confirmation (verification layer 3): post the received
 * data back to PayFast and require the literal response "VALID". This is the
 * strongest of the three checks — it proves PayFast itself issued this exact
 * notification, even if the signature secret or IP list were compromised.
 *
 * The postback body is the raw ITN data minus the `signature` field, in the
 * order received, values used verbatim (the official PHP sample does the same —
 * re-encoding would break the match).
 *
 * Network errors are NOT swallowed: the caller must treat "could not confirm"
 * differently from "confirmed invalid" (retry vs reject).
 *
 * @param {Buffer|string} rawBody
 * @returns {Promise<boolean>} true iff PayFast answered VALID
 */
async function validateItn(rawBody, { fetchImpl = fetch, env = process.env } = {}) {
  const raw = Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : String(rawBody || '');
  const parts = raw
    .split('&')
    .filter((kv) => kv && !kv.startsWith('signature='));
  const res = await fetchImpl(`${processHost(env)}/eng/query/validate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: parts.join('&'),
  });
  if (!res.ok) {
    throw new Error(`PayFast validate endpoint returned ${res.status}`);
  }
  const text = (await res.text()).trim();
  return text === 'VALID';
}

/**
 * Signature for PayFast REST API requests (api.payfast.co.za). Unlike the
 * checkout signature (insertion order, passphrase appended last), API request
 * signatures sort ALL parameters — headers, body and passphrase —
 * alphabetically by key before hashing.
 * @param {Record<string,string>} params  header + body params, unencoded
 * @param {string} [passphrase]
 * @returns {string} lowercase MD5 hex
 */
function apiSignature(params, passphrase) {
  const all = { ...params };
  if (passphrase) all.passphrase = passphrase;
  const str = Object.keys(all)
    .sort()
    .filter((k) => all[k] !== undefined && all[k] !== null && String(all[k]) !== '')
    .map((k) => `${k}=${pfEncode(all[k])}`)
    .join('&');
  return crypto.createHash('md5').update(str).digest('hex');
}

/**
 * Cancel a subscription via the PayFast API.
 * PUT /subscriptions/:token/cancel — idempotent from the caller's view: a 404
 * (unknown/already-cancelled token) resolves true rather than throwing, any
 * other failure throws so callers never mistake "still billing" for done.
 * @param {string} token  PayFast subscription token from the ITN
 * @returns {Promise<boolean>}
 */
async function cancelSubscription(token, { fetchImpl = fetch, env = process.env, now = new Date() } = {}) {
  const { merchantId, passphrase } = credentials(env);
  if (!merchantId) throw new Error('PAYFAST_MERCHANT_ID not set');
  if (!token) throw new Error('PayFast subscription token required');

  // PayFast timestamp format: ISO-8601 to seconds, no milliseconds.
  const timestamp = now.toISOString().split('.')[0];
  const headers = {
    'merchant-id': merchantId,
    version: 'v1',
    timestamp,
  };
  const signature = apiSignature(headers, passphrase);

  const testing = isSandbox(env) ? '?testing=true' : '';
  const res = await fetchImpl(
    `${API_HOST}/subscriptions/${encodeURIComponent(token)}/cancel${testing}`,
    { method: 'PUT', headers: { ...headers, signature } }
  );

  if (res.ok) return true;
  if (res.status === 404) return true; // already gone — cancel is idempotent
  const body = await res.text().catch(() => '');
  const err = new Error(`PayFast cancel failed (${res.status}): ${body.slice(0, 300)}`);
  err.status = res.status;
  throw err;
}

module.exports = {
  LIVE_PROCESS_HOST,
  SANDBOX_PROCESS_HOST,
  API_HOST,
  PAYFAST_IP_RANGES,
  isSandbox,
  credentials,
  processHost,
  pfEncode,
  signParams,
  verifyItnSignature,
  parseItnBody,
  isPayfastIp,
  validateItn,
  apiSignature,
  cancelSubscription,
};
