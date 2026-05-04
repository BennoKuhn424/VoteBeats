const db = require('../utils/database');
const { fulfillPaidRequest } = require('../utils/paymentFulfill');
const { getProvider } = require('../providers/payment');

/**
 * Provider-agnostic patron-payment webhook.
 *
 * Signature verification + vendor payload translation live in the active
 * PatronPaymentProvider. This handler only sees normalized events.
 */

// Rate limit per IP
const WEBHOOK_WINDOW_MS = 60_000;
const WEBHOOK_MAX = 30;
const webhookHits = new Map();

function isWebhookRateLimited(ip) {
  const now = Date.now();
  const hits = (webhookHits.get(ip) || []).filter((t) => now - t < WEBHOOK_WINDOW_MS);
  if (hits.length >= WEBHOOK_MAX) return true;
  hits.push(now);
  webhookHits.set(ip, hits);
  if (webhookHits.size > 5000) {
    for (const [k, v] of webhookHits) {
      if (!v.length || v[v.length - 1] < now - WEBHOOK_WINDOW_MS) webhookHits.delete(k);
    }
  }
  return false;
}

// POST /api/webhooks/payment  (raw body — mounted in app.js before express.json)
async function patronPaymentWebhook(req, res) {
  const ip = req.ip || req.socket?.remoteAddress || 'unknown';
  const provider = getProvider();

  if (isWebhookRateLimited(ip)) {
    console.warn(`Patron-payment webhook rate-limited: ip=${ip}`);
    return res.sendStatus(429);
  }

  const rawBuf = Buffer.isBuffer(req.body)
    ? req.body
    : Buffer.from(typeof req.body === 'string' ? req.body : '', 'utf8');

  let payload;
  try {
    payload = JSON.parse(rawBuf.toString('utf8') || '{}');
  } catch {
    console.warn(`Patron-payment webhook bad JSON: ip=${ip}`);
    return res.sendStatus(400);
  }

  if (!provider.verifyWebhook(rawBuf, req.headers)) {
    console.warn(`[${provider.name}] patron-payment webhook signature failed: ip=${ip}`);
    return res.sendStatus(403);
  }

  const evt = provider.normalizeWebhookEvent(payload);
  if (evt.kind !== 'payment_succeeded' || !evt.checkoutId) {
    // Ack non-payment events so the provider stops retrying.
    return res.sendStatus(200);
  }

  const pending = db.getPendingPayment(evt.checkoutId);
  if (!pending) {
    // Already fulfilled (idempotent) or never existed — nothing to do.
    return res.sendStatus(200);
  }

  if (!provider.isConfigured()) {
    console.error('Patron-payment webhook: provider not configured — cannot verify, rejecting');
    return res.sendStatus(503);
  }

  // Defence in depth: never trust webhook payload alone — call provider API to confirm.
  const { verified, amountCents: providerAmount } = await provider.verifyCheckout(evt.checkoutId);
  if (!verified) {
    console.warn(`[${provider.name}] verification failed for checkoutId=${evt.checkoutId}, ip=${ip}`);
    return res.sendStatus(200);
  }

  // SECURITY: hard amount guard.
  // We must have BOTH a numeric expectedCents and a numeric providerAmount,
  // and they must match. Anything else (null, missing, non-number, mismatch)
  // means we cannot confirm the patron paid the right amount — refuse to
  // fulfil. Ack with 200 so the provider stops retrying; the discrepancy is
  // logged loudly for ops follow-up.
  const expectedCents = pending.amountCents;
  const expectedOk = Number.isFinite(expectedCents);
  const providerOk = Number.isFinite(providerAmount);
  if (!expectedOk || !providerOk || providerAmount !== expectedCents) {
    console.error(JSON.stringify({
      t: new Date().toISOString(),
      msg: 'webhook-amount-guard-rejected',
      provider: provider.name,
      checkoutId: evt.checkoutId,
      venueCode: pending.venueCode,
      expectedCents: expectedOk ? expectedCents : null,
      providerAmount: providerOk ? providerAmount : null,
      reason: !expectedOk ? 'expected_missing' : !providerOk ? 'provider_missing' : 'mismatch',
      ip,
    }));
    return res.sendStatus(200);
  }

  const fulfilled = await fulfillPaidRequest(evt.checkoutId, providerAmount);
  console.log(JSON.stringify({
    t: new Date().toISOString(),
    msg: 'webhook-fulfill',
    provider: provider.name,
    checkoutId: evt.checkoutId,
    fulfilled,
    amountCents: providerAmount,
    venueCode: pending.venueCode,
    ip,
  }));

  res.sendStatus(200);
}

module.exports = { patronPaymentWebhook };
