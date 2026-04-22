const db = require('../utils/database');
const { getProvider } = require('../providers/subscription');
const {
  sendSubscriptionReceiptEmail,
  sendSubscriptionPaymentFailedEmail,
  sendSubscriptionCanceledEmail,
} = require('../utils/email');

/**
 * Provider-agnostic subscription webhook.
 *
 * The active SubscriptionProvider is responsible for signature verification
 * and translating the vendor-specific payload into a normalized event shape
 * (see server/providers/subscription/SubscriptionProvider.js). This handler
 * only knows about normalized events — adding a new billing vendor means
 * writing a provider class, not touching this route.
 */

const SUBSCRIPTION_AMOUNT_ZAR = parseInt(
  process.env.SUBSCRIPTION_AMOUNT_ZAR || process.env.PAYSTACK_SUBSCRIPTION_AMOUNT_ZAR,
  10,
) || 599;

function getVenueEmail(sub) {
  const venue = db.getVenue(sub.venueCode);
  return venue?.owner?.email ? { email: venue.owner.email, venueName: venue.name } : null;
}

// Rate limit per IP — mirrors yoco webhook pattern
const WEBHOOK_WINDOW_MS = 60_000;
const WEBHOOK_MAX = 60;
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

// POST /api/webhooks/subscription  (raw body — mounted in app.js before express.json)
async function subscriptionWebhook(req, res) {
  const ip = req.ip || req.socket?.remoteAddress || 'unknown';
  const provider = getProvider();

  if (isWebhookRateLimited(ip)) {
    console.warn(`Subscription webhook rate-limited: ip=${ip}`);
    return res.sendStatus(429);
  }

  const rawBuf = Buffer.isBuffer(req.body)
    ? req.body
    : Buffer.from(typeof req.body === 'string' ? req.body : '', 'utf8');

  if (!provider.verifyWebhook(rawBuf, req.headers)) {
    console.warn(`[${provider.name}] subscription webhook signature failed: ip=${ip}`);
    return res.sendStatus(403);
  }

  let payload;
  try {
    payload = JSON.parse(rawBuf.toString('utf8') || '{}');
  } catch {
    return res.sendStatus(400);
  }

  const evt = provider.normalizeWebhookEvent(payload);

  try {
    switch (evt.kind) {
      case 'subscription_activated':
        handleActivated(evt);
        break;
      case 'subscription_canceled':
        handleCanceled(evt);
        break;
      case 'charge_succeeded':
        handleChargeSucceeded(evt);
        break;
      case 'payment_failed':
        handlePaymentFailed(evt);
        break;
      default:
        // Ack unhandled events so the provider stops retrying.
        break;
    }
    res.sendStatus(200);
  } catch (err) {
    console.error(`[SUB WEBHOOK] ${evt.rawEvent || evt.kind} failed:`, err.message);
    // 200 so the provider doesn't retry a non-retriable error; we've logged.
    res.sendStatus(200);
  }
}

function findSubscription(providerSubscriptionId) {
  if (!providerSubscriptionId) return null;
  return db.getSubscriptionByProviderId(providerSubscriptionId);
}

function handleActivated(evt) {
  const sub = findSubscription(evt.providerSubscriptionId);
  if (!sub) {
    console.warn('[SUB WEBHOOK] activated for unknown subscription', evt.providerSubscriptionId);
    return;
  }

  const trialStillActive = sub.trialEndsAt && sub.trialEndsAt > Date.now();
  const status = trialStillActive ? 'trialing' : 'active';

  db.upsertSubscription({
    ...sub,
    providerSubscriptionId: evt.providerSubscriptionId || sub.providerSubscriptionId,
    status,
    currentPeriodEnd: evt.nextPaymentDate || sub.currentPeriodEnd,
  });
}

function handleCanceled(evt) {
  const sub = findSubscription(evt.providerSubscriptionId);
  if (!sub) return;

  db.upsertSubscription({ ...sub, status: 'canceled' });

  const recip = getVenueEmail(sub);
  if (recip) {
    sendSubscriptionCanceledEmail(recip.email, { venueName: recip.venueName })
      .catch((e) => console.warn('[SUB WEBHOOK] cancel email failed:', e.message));
  }
}

function handleChargeSucceeded(evt) {
  const sub = findSubscription(evt.providerSubscriptionId);
  if (!sub) return;

  const now = Date.now();
  const periodEnd = evt.nextPaymentDate || (now + 30 * 24 * 60 * 60 * 1000);

  db.upsertSubscription({
    ...sub,
    status: 'active',
    currentPeriodEnd: periodEnd,
  });

  const recip = getVenueEmail(sub);
  if (recip) {
    sendSubscriptionReceiptEmail(recip.email, {
      venueName: recip.venueName,
      amountZar: SUBSCRIPTION_AMOUNT_ZAR,
      nextPaymentDate: periodEnd,
    }).catch((e) => console.warn('[SUB WEBHOOK] receipt email failed:', e.message));
  }
}

function handlePaymentFailed(evt) {
  const sub = findSubscription(evt.providerSubscriptionId);
  if (!sub) return;

  db.upsertSubscription({ ...sub, status: 'past_due' });

  const recip = getVenueEmail(sub);
  if (recip) {
    sendSubscriptionPaymentFailedEmail(recip.email, {
      venueName: recip.venueName,
      amountZar: SUBSCRIPTION_AMOUNT_ZAR,
    }).catch((e) => console.warn('[SUB WEBHOOK] payment-failed email failed:', e.message));
  }
}

module.exports = { subscriptionWebhook };
