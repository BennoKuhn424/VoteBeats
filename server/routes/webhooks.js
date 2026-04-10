const db = require('../utils/database');
const { fulfillPaidRequest } = require('../utils/paymentFulfill');
const { verifyYocoWebhookSignature, verifyCheckoutWithYoco } = require('../utils/yoco');

/**
 * Webhook-specific rate limit tracking.
 * Allow max WEBHOOK_MAX calls per WEBHOOK_WINDOW_MS; reject with 429 after that.
 * Keyed by IP so a single attacker can't flood us.
 */
const WEBHOOK_WINDOW_MS = 60_000;
const WEBHOOK_MAX = 30; // generous — Yoco might retry, but 30/min is plenty
const webhookHits = new Map(); // ip -> [ts, ts, …]

function isWebhookRateLimited(ip) {
  const now = Date.now();
  const hits = (webhookHits.get(ip) || []).filter((t) => now - t < WEBHOOK_WINDOW_MS);
  if (hits.length >= WEBHOOK_MAX) return true;
  hits.push(now);
  webhookHits.set(ip, hits);
  // Prune map if it gets large
  if (webhookHits.size > 5000) {
    for (const [k, v] of webhookHits) {
      if (!v.length || v[v.length - 1] < now - WEBHOOK_WINDOW_MS) webhookHits.delete(k);
    }
  }
  return false;
}

// ── Webhook handler ──────────────────────────────────────────────────────────
// POST /api/webhooks/yoco  (raw body — mounted in app.js before express.json)
async function yocoWebhook(req, res) {
  const ip = req.ip || req.socket?.remoteAddress || 'unknown';

  // ── Rate limit ──
  if (isWebhookRateLimited(ip)) {
    console.warn(`Webhook rate-limited: ip=${ip}`);
    return res.sendStatus(429);
  }

  // ── Parse body ──
  let payload;
  try {
    const raw = Buffer.isBuffer(req.body)
      ? req.body.toString('utf8')
      : typeof req.body === 'string' ? req.body : '';
    payload = JSON.parse(raw || '{}');
  } catch {
    console.warn(`Webhook bad JSON: ip=${ip}`);
    return res.sendStatus(400);
  }

  const rawBuf = Buffer.isBuffer(req.body)
    ? req.body
    : Buffer.from(typeof req.body === 'string' ? req.body : '', 'utf8');

  if (!verifyYocoWebhookSignature(rawBuf, req.headers)) {
    console.warn(`Webhook signature verification failed: ip=${ip}`);
    return res.sendStatus(403);
  }

  // ── Ignore non-payment events (acknowledge so Yoco stops retrying) ──
  if (payload.type !== 'payment.succeeded') {
    return res.sendStatus(200);
  }

  // ── Extract checkoutId ──
  const checkoutId =
    payload.payload?.metadata?.checkoutId ?? payload.payload?.id ?? payload.id;
  if (!checkoutId || typeof checkoutId !== 'string') {
    console.warn(`Webhook missing checkoutId: ip=${ip}`);
    return res.sendStatus(200);
  }

  // ── Must have a matching pending payment (we created it in create-payment) ──
  const pending = db.getPendingPayment(checkoutId);
  if (!pending) {
    // Already fulfilled (idempotent) or never existed — nothing to do
    return res.sendStatus(200);
  }

  // ── Server-side verification: call Yoco API to confirm payment is real ──
  const yocoSecret = process.env.YOCO_SECRET_KEY;
  if (!yocoSecret) {
    console.error('Webhook: YOCO_SECRET_KEY not set — cannot verify payment, rejecting');
    return res.sendStatus(503);
  }

  const { verified, amountCents: yocoAmount } = await verifyCheckoutWithYoco(checkoutId, yocoSecret);
  if (!verified) {
    console.warn(`Webhook: Yoco verification failed for checkoutId=${checkoutId}, ip=${ip}`);
    // Return 200 so Yoco doesn't keep retrying a genuinely-unpaid event,
    // but do NOT fulfill the request.
    return res.sendStatus(200);
  }

  // ── Amount guard: reject if Yoco reports a different amount than expected ──
  const expectedCents = pending.amountCents;
  if (yocoAmount != null && expectedCents != null && yocoAmount !== expectedCents) {
    console.error(
      `Webhook amount mismatch: checkoutId=${checkoutId} expected=${expectedCents} got=${yocoAmount}`
    );
    return res.sendStatus(200);
  }

  // ── Fulfill ──
  const fulfilled = await fulfillPaidRequest(checkoutId, yocoAmount ?? expectedCents);
  console.log(JSON.stringify({
    t: new Date().toISOString(),
    msg: 'webhook-fulfill',
    checkoutId,
    fulfilled,
    amountCents: yocoAmount ?? expectedCents,
    venueCode: pending.venueCode,
    ip,
  }));

  res.sendStatus(200);
}

module.exports = { yocoWebhook };
