const crypto = require('crypto');

/**
 * Yoco Checkout API webhook signing (HMAC SHA256 over webhook-id.webhook-timestamp.rawBody).
 * Set YOCO_WEBHOOK_SECRET to the `whsec_...` value from the Yoco dashboard.
 * https://developer.yoco.com/guides/online-payments/webhooks/verifying-the-events
 */
function verifyYocoWebhookSignature(rawBodyBuf, headers) {
  const secret = process.env.YOCO_WEBHOOK_SECRET;
  if (!secret) {
    console.warn('Webhook: YOCO_WEBHOOK_SECRET is not configured');
    return false;
  }

  const webhookId = headers['webhook-id'];
  const webhookTs = headers['webhook-timestamp'];
  const sigHeader = headers['webhook-signature'];
  if (!webhookId || !webhookTs || !sigHeader) {
    console.warn('Webhook: missing webhook-id / webhook-timestamp / webhook-signature');
    return false;
  }
  const tsSec = parseInt(webhookTs, 10);
  if (!Number.isFinite(tsSec) || Math.abs(Date.now() / 1000 - tsSec) > 180) {
    console.warn('Webhook: timestamp outside 3-minute window');
    return false;
  }

  let keyBytes;
  try {
    const b64 = secret.startsWith('whsec_') ? secret.slice(6) : secret;
    keyBytes = Buffer.from(b64, 'base64');
  } catch {
    return false;
  }

  const rawStr = Buffer.isBuffer(rawBodyBuf) ? rawBodyBuf.toString('utf8') : String(rawBodyBuf || '');
  const signedContent = `${webhookId}.${webhookTs}.${rawStr}`;
  const expected = crypto.createHmac('sha256', keyBytes).update(signedContent).digest('base64');

  const tokens = String(sigHeader).trim().split(/\s+/);
  const expBuf = Buffer.from(expected, 'base64');
  for (const tok of tokens) {
    const comma = tok.indexOf(',');
    if (comma === -1) continue;
    const version = tok.slice(0, comma);
    const sigB64 = tok.slice(comma + 1);
    if (version !== 'v1') continue;
    try {
      const b = Buffer.from(sigB64, 'base64');
      if (expBuf.length === b.length && crypto.timingSafeEqual(expBuf, b)) return true;
    } catch (_) {
      /* length mismatch */
    }
  }
  console.warn('Webhook: signature verification failed');
  return false;
}

/**
 * Call Yoco's API to confirm a checkout status (shared by webhooks, queue, venue).
 * Returns { verified, amountCents } or { verified: false }.
 */
async function verifyCheckoutWithYoco(checkoutId, yocoSecret) {
  try {
    const res = await fetch(
      `https://payments.yoco.com/api/checkouts/${encodeURIComponent(checkoutId)}`,
      { headers: { Authorization: `Bearer ${yocoSecret}` } }
    );
    if (!res.ok) return { verified: false };
    const data = await res.json();
    const status = (data.status || '').toLowerCase();
    const hasPayment = !!(data.paymentId || data.payment?.id);
    const paid =
      status === 'completed' || status === 'succeeded' ||
      status === 'complete'  || status === 'success'  || hasPayment;
    return {
      verified: paid,
      amountCents: data.amount ?? data.payment?.amount ?? null,
    };
  } catch (err) {
    console.error('Yoco verify call failed:', err.message);
    return { verified: false };
  }
}

module.exports = {
  verifyYocoWebhookSignature,
  verifyCheckoutWithYoco,
};
