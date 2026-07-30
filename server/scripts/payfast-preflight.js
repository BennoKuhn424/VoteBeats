#!/usr/bin/env node
/**
 * PayFast preflight — checks that a deployment can actually complete a
 * subscription, BEFORE a venue's money is involved.
 *
 * The failure this exists to prevent: PayFast happily takes a payment against a
 * checkout whose notify_url is wrong, unreachable, or pointing at a service
 * that rejects the ITN. Activation here is ITN-driven, so in every one of those
 * cases the venue is charged and never activated, and nothing in the app says
 * so. Each check below maps to one way that happens.
 *
 * Usage:
 *   node scripts/payfast-preflight.js                  # checks local .env
 *   node scripts/payfast-preflight.js --api-url https://speeldit-api.onrender.com
 *   npm run payfast:check -- --api-url https://...
 *
 * Exit codes: 0 = ready, 1 = at least one FAIL. WARNs never fail the run.
 */

require('dotenv').config();
const crypto = require('crypto');
const payfast = require('../utils/payfast');

const args = process.argv.slice(2);
function arg(name) {
  const i = args.indexOf(`--${name}`);
  return i !== -1 && args[i + 1] ? args[i + 1] : null;
}

const API_URL = (arg('api-url') || process.env.PUBLIC_API_URL || '').replace(/\/+$/, '');

// PayFast's published sandbox merchant. Anything else in sandbox mode means the
// credentials and the host disagree.
const SANDBOX_MERCHANT_ID = '10000100';

let fails = 0;
let warns = 0;
const line = (s = '') => console.log(s);
function pass(msg, detail) { line(`  \x1b[32mPASS\x1b[0m  ${msg}${detail ? `\n        ${detail}` : ''}`); }
function fail(msg, detail) { fails++; line(`  \x1b[31mFAIL\x1b[0m  ${msg}${detail ? `\n        ${detail}` : ''}`); }
function warn(msg, detail) { warns++; line(`  \x1b[33mWARN\x1b[0m  ${msg}${detail ? `\n        ${detail}` : ''}`); }
function info(msg) { line(`  \x1b[90m····\x1b[0m  ${msg}`); }
function section(t) { line(); line(`\x1b[1m${t}\x1b[0m`); }

// ── 1. Provider selection ───────────────────────────────────────────────────
section('Provider');

const provider = (process.env.SUBSCRIPTION_PROVIDER || 'paystack').trim().toLowerCase();
if (provider === 'payfast') {
  pass('SUBSCRIPTION_PROVIDER=payfast');
} else {
  fail(
    `SUBSCRIPTION_PROVIDER is "${provider}", not "payfast"`,
    'Venue billing would run through the wrong provider entirely.'
  );
}

// ── 2. Credentials ──────────────────────────────────────────────────────────
section('Credentials');

const merchantId = process.env.PAYFAST_MERCHANT_ID;
const merchantKey = process.env.PAYFAST_MERCHANT_KEY;
const passphrase = process.env.PAYFAST_PASSPHRASE;
const sandbox = payfast.isSandbox();

if (merchantId) pass(`PAYFAST_MERCHANT_ID set (${merchantId})`);
else fail('PAYFAST_MERCHANT_ID missing', 'isConfigured() returns false — /start refuses to build a checkout.');

if (merchantKey) pass(`PAYFAST_MERCHANT_KEY set (${String(merchantKey).slice(0, 4)}…)`);
else fail('PAYFAST_MERCHANT_KEY missing', 'isConfigured() returns false — /start refuses to build a checkout.');

// ── 3. Sandbox / live coherence ─────────────────────────────────────────────
section('Mode');

info(`Checkout host:  ${payfast.processHost()}`);
info(`Validate host:  ${payfast.processHost()}/eng/query/validate`);

if (sandbox) {
  pass('PAYFAST_SANDBOX=true — using sandbox.payfast.co.za');

  if (process.env.NODE_ENV === 'production') {
    warn(
      'NODE_ENV=production WITH PAYFAST_SANDBOX=true',
      'Fine while testing. This MUST be removed before taking real money: sandbox mode\n        also skips the ITN source-IP check, so anything could post a fake activation.'
    );
  }
  if (merchantId && merchantId !== SANDBOX_MERCHANT_ID) {
    warn(
      `Sandbox mode but merchant id is ${merchantId}, not the standard ${SANDBOX_MERCHANT_ID}`,
      'Only correct if you were issued a personal sandbox merchant account.'
    );
  }
  if (passphrase) {
    warn(
      'PAYFAST_PASSPHRASE is set while in sandbox',
      'Sandbox accounts have NO passphrase unless you set one in the sandbox dashboard.\n        A passphrase mismatch makes every signature invalid — the #1 cause of a\n        sandbox ITN silently 403ing. Unset it unless the sandbox dashboard has one.'
    );
  } else {
    pass('No passphrase set — matches a default sandbox account');
  }
} else {
  pass('Live mode — using www.payfast.co.za');
  if (!passphrase) {
    warn(
      'No PAYFAST_PASSPHRASE in live mode',
      'If a passphrase is configured on your PayFast account, signatures will not match.\n        Set it here to exactly what the dashboard shows (Settings → Security passphrase).'
    );
  } else {
    pass('PAYFAST_PASSPHRASE set');
  }
}

// ── 4. The ITN address ──────────────────────────────────────────────────────
section('ITN address');

if (!API_URL) {
  fail(
    'PUBLIC_API_URL not set (and no --api-url given)',
    'Activation is ITN-driven. Without this the checkout carries a broken notify_url,\n        so a venue can pay and never activate. isConfigured() blocks checkout for this reason.'
  );
} else {
  const notifyUrl = `${API_URL}/api/webhooks/subscription`;
  info(`notify_url sent to PayFast: ${notifyUrl}`);

  if (API_URL.startsWith('https://')) {
    pass('PUBLIC_API_URL is https');
  } else if (API_URL.startsWith('http://')) {
    fail('PUBLIC_API_URL is http, not https', 'PayFast will not post an ITN to a plaintext endpoint.');
  } else {
    fail(`PUBLIC_API_URL is not a URL: "${API_URL}"`, 'Must include the scheme, e.g. https://speeldit-api.onrender.com');
  }
  if (/localhost|127\.0\.0\.1/.test(API_URL)) {
    fail('PUBLIC_API_URL points at localhost', "PayFast's servers cannot reach your machine. Use the Render URL or a tunnel.");
  }
}

// ── 5. Signature implementation ─────────────────────────────────────────────
section('Signature implementation');

{
  // Self-test against an independently computed MD5. If our encoder or ordering
  // ever regresses, every signature PayFast sees becomes invalid — this catches
  // that without needing to talk to PayFast at all.
  const pairs = [['merchant_id', '10000100'], ['blank', ''], ['amount', '0.00'], ['item_name', 'Speeldit subscription']];
  const expected = crypto
    .createHash('md5')
    .update('merchant_id=10000100&amount=0.00&item_name=Speeldit+subscription&passphrase=t%2Bst')
    .digest('hex');
  const actual = payfast.signParams(pairs, 't+st');
  if (actual === expected) {
    pass('MD5 signing matches PayFast rules (order kept, blanks dropped, RFC1738 encoding)');
  } else {
    fail('Signature implementation mismatch', `expected ${expected}, got ${actual}`);
  }
}

// ── 5b. Raw env inspection ──────────────────────────────────────────────────
// Whitespace in a dashboard-pasted value is invisible and fatal: it gets signed
// (encoded as '+'), so PayFast computes a different hash and answers
// "Generated signature does not match submitted signature" — an error that
// looks like a code bug. Show the exact bytes.
section('Raw values (│ marks the exact boundaries)');

for (const key of ['PAYFAST_MERCHANT_ID', 'PAYFAST_MERCHANT_KEY', 'PAYFAST_PASSPHRASE', 'PUBLIC_API_URL', 'SUBSCRIPTION_PROVIDER']) {
  const raw = process.env[key];
  if (raw === undefined) { info(`${key.padEnd(22)} (not set)`); continue; }
  const dirty = raw !== raw.trim();
  const shown = /KEY|PASSPHRASE/.test(key) && raw.trim()
    ? `${raw.slice(0, raw.length - raw.trimStart().length)}${raw.trim().slice(0, 4)}…${raw.slice(raw.trimEnd().length)}`
    : raw;
  if (dirty) {
    fail(`${key} has leading/trailing whitespace:  │${shown}│`, 'This is signed verbatim and breaks the signature. Delete the value and retype it.');
  } else {
    info(`${key.padEnd(22)} │${shown}│`);
  }
}

// ── 5c. Checkout dry-run ────────────────────────────────────────────────────
// Reproduces exactly what /subscriptions/start would send, without creating
// anything. Run with --dry-run-checkout when PayFast rejects the signature.
async function dryRunCheckout() {
  if (!args.includes('--dry-run-checkout')) return;
  section('Checkout dry-run');

  const Provider = require('../providers/subscription/PayfastSubscriptionProvider');
  const instance = new Provider();

  return instance
    .initCardCapture({
      email: 'preflight@example.test',
      amountZar: parseInt(process.env.SUBSCRIPTION_AMOUNT_ZAR, 10) || 599,
      reference: 'vbsub_PREFLT_0000000000000',
      callbackUrl: `${(process.env.PUBLIC_URL || 'https://example.test').replace(/\/+$/, '')}/venue/billing/complete`,
      metadata: {},
    })
    .then(({ authorizationUrl }) => {
      const url = new URL(authorizationUrl);
      const creds = payfast.credentials();
      const signed = [];
      for (const [k, v] of url.searchParams.entries()) {
        if (k === 'signature') continue;
        signed.push(`${k}=${payfast.pfEncode(v)}`);
      }
      if (creds.passphrase) signed.push(`passphrase=${payfast.pfEncode(creds.passphrase)}`);

      line('  Signed string (this exact text is MD5-hashed):');
      line(`  \x1b[90m${signed.join('&')}\x1b[0m`);
      line();
      line(`  Signature sent: ${url.searchParams.get('signature')}`);
      line(`  Passphrase in signature: ${creds.passphrase ? 'YES' : 'no'}`);
      line();
      info('If PayFast rejects this, the usual cause is the passphrase: it must match the');
      info('dashboard EXACTLY, and must be absent here if the account has none.');
      line();
      line('  Full checkout URL:');
      line(`  \x1b[90m${authorizationUrl}\x1b[0m`);
    })
    .catch((e) => fail('Could not build a checkout', e.message));
}

// ── 6. Live probes ──────────────────────────────────────────────────────────
async function probe() {
  if (!API_URL || !/^https?:\/\//.test(API_URL) || /localhost|127\.0\.0\.1/.test(API_URL)) {
    section('Live probes');
    warn('Skipped — no reachable PUBLIC_API_URL to probe');
    return;
  }

  section('Live probes');

  // 6a. Is the service up and is its database readable?
  try {
    const res = await fetch(`${API_URL}/health`, { signal: AbortSignal.timeout(20000) });
    const body = await res.json().catch(() => ({}));
    if (res.ok && body.db === 'ok') {
      pass('GET /health → service up, database readable');
    } else if (res.ok) {
      fail(`GET /health → db: "${body.db}"`, 'The service is running but cannot read its database.');
    } else {
      fail(`GET /health → HTTP ${res.status}`);
    }
  } catch (err) {
    fail('GET /health unreachable', `${err.message}\n        Render free instances sleep — retry once to wake it.`);
  }

  // 6b. Does the ITN endpoint exist and enforce verification?
  // An unsigned form post must be REJECTED (403). 404 means PayFast would post
  // into the void; 200 would mean the endpoint accepts unverified money events.
  try {
    const res = await fetch(`${API_URL}/api/webhooks/subscription`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'm_payment_id=preflight&payment_status=COMPLETE&amount_gross=599.00',
      signal: AbortSignal.timeout(20000),
    });

    if (res.status === 403) {
      pass('POST /api/webhooks/subscription → 403 for an unsigned probe (endpoint live and enforcing)');
    } else if (res.status === 404) {
      fail(
        'POST /api/webhooks/subscription → 404',
        'PayFast would post activation ITNs into the void. Check PUBLIC_API_URL points at the API\n        service itself, not the frontend.'
      );
    } else if (res.status === 200) {
      fail(
        'POST /api/webhooks/subscription → 200 for an UNSIGNED probe',
        'The endpoint is accepting unverified money events. Do not go live.'
      );
    } else if (res.status === 500) {
      warn(
        'POST /api/webhooks/subscription → 500',
        "Expected when SUBSCRIPTION_PROVIDER=payfast and PayFast's /validate cannot be reached.\n        The 500 is deliberate (PayFast then retries). Confirm outbound network from Render."
      );
    } else if (res.status === 429) {
      warn('POST /api/webhooks/subscription → 429 rate-limited', 'Wait a minute and re-run.');
    } else {
      warn(`POST /api/webhooks/subscription → HTTP ${res.status}`, 'Expected 403 for an unsigned probe.');
    }
  } catch (err) {
    fail('ITN endpoint unreachable', err.message);
  }

  // 6c. Can we reach PayFast's own validate host from here?
  try {
    const res = await fetch(`${payfast.processHost()}/eng/query/validate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'preflight=1',
      signal: AbortSignal.timeout(20000),
    });
    pass(`PayFast ${sandbox ? 'sandbox' : 'live'} /validate reachable (HTTP ${res.status})`);
    info('A non-VALID answer is expected here — this only proves the host is reachable.');
  } catch (err) {
    warn(
      `Could not reach ${payfast.processHost()} from this machine`,
      `${err.message}\n        What matters is that RENDER can reach it, which this run cannot prove.`
    );
  }
}

dryRunCheckout().then(probe).then(() => {
  section('Result');
  if (fails === 0 && warns === 0) {
    line('  \x1b[32mReady.\x1b[0m All checks passed.');
  } else if (fails === 0) {
    line(`  \x1b[33mReady with ${warns} warning(s).\x1b[0m Read them before taking real money.`);
  } else {
    line(`  \x1b[31m${fails} failure(s), ${warns} warning(s).\x1b[0m A venue could pay and not be activated.`);
  }
  line();
  process.exit(fails === 0 ? 0 : 1);
});
