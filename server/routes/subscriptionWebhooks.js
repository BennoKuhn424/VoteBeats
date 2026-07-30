const db = require('../utils/database');
const { getProvider } = require('../providers/subscription');
const {
  sendSubscriptionReceiptEmail,
  sendSubscriptionPaymentFailedEmail,
  sendSubscriptionCanceledEmail,
  sendTrialStartedEmail,
} = require('../utils/email');

/**
 * Provider-agnostic subscription webhook.
 *
 * The active SubscriptionProvider is responsible for signature verification,
 * body parsing (JSON vs PayFast's form-encoded ITN), any asynchronous
 * confirmation (PayFast's server-to-server /validate postback), and
 * translating the vendor-specific payload into a normalized event shape
 * (see server/providers/subscription/SubscriptionProvider.js). This handler
 * only knows about normalized events — adding a new billing vendor means
 * writing a provider class, not touching this route.
 *
 * For webhook-activated providers (provider.activationVia === 'webhook',
 * i.e. PayFast) this route is ALSO the activation path: the first verified
 * charge event flips the 'incomplete' subscription created by /start into
 * trialing/active. See handleChargeSucceeded.
 */

// Read at call time (not module load) so tests and live config changes see
// the current value.
function subscriptionAmountZar() {
  return parseInt(
    process.env.SUBSCRIPTION_AMOUNT_ZAR || process.env.PAYSTACK_SUBSCRIPTION_AMOUNT_ZAR,
    10,
  ) || 599;
}

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

  // Providers that verify the caller's source IP (PayFast) need the address
  // Express resolved via trust-proxy — the raw x-real-ip header is not set by
  // every host, so supply req.ip as the fallback.
  const headersWithIp = { ...req.headers, 'x-real-ip': req.headers['x-real-ip'] || ip };
  if (!provider.verifyWebhook(rawBuf, headersWithIp)) {
    console.warn(`[${provider.name}] subscription webhook signature failed: ip=${ip}`);
    return res.sendStatus(403);
  }

  // Asynchronous confirmation (PayFast: server-to-server /validate postback).
  // "Confirmed invalid" → reject for good. "Could not reach the provider" →
  // 500 WITHOUT processing, so the provider retries delivery later — a money
  // event must never be dropped because of a transient network blip.
  // (Optional method: providers without an async check skip it.)
  if (typeof provider.validateWebhook === 'function') {
    try {
      const confirmed = await provider.validateWebhook(rawBuf);
      if (!confirmed) {
        console.warn(`[${provider.name}] subscription webhook failed provider validation: ip=${ip}`);
        return res.sendStatus(403);
      }
    } catch (err) {
      console.error(`[${provider.name}] subscription webhook validation unreachable (will be retried): ${err.message}`);
      return res.sendStatus(500);
    }
  }

  let payload;
  try {
    payload = typeof provider.parseWebhookBody === 'function'
      ? provider.parseWebhookBody(rawBuf)
      : JSON.parse(rawBuf.toString('utf8') || '{}');
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

/**
 * Locate the subscription an event refers to.
 * Primary key is the provider's subscription id, but the FIRST PayFast ITN
 * arrives carrying a token we have never seen — the sub was stored under our
 * own init reference (m_payment_id) at /start. Fall back to that reference so
 * the activating event always finds its home.
 */
function findSubscription(evt) {
  if (evt.providerSubscriptionId) {
    const byId = db.getSubscriptionByProviderId(evt.providerSubscriptionId);
    if (byId) return byId;
  }
  if (evt.reference) {
    const byRef = db.getSubscriptionByInitReference(evt.reference);
    if (byRef) return byRef;

    // Last resort: recover the venue from our own reference format.
    // /start stores exactly ONE init reference per venue, so a venue that
    // started checkout twice and completed the FIRST hosted page produces an
    // ITN whose reference has already been overwritten. Without this the venue
    // pays and is never activated. The reference is server-minted and reaches
    // us only through a signature-, source-IP- and postback-verified ITN, so
    // reading the venue code back out of it is safe.
    const m = /^vbsub_([A-Za-z0-9]+)_\d+$/.exec(evt.reference);
    if (m) {
      const byVenue = db.getSubscription(m[1]);
      if (byVenue) return byVenue;
    }
  }
  return null;
}

function handleActivated(evt) {
  const sub = findSubscription(evt);
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
  const sub = findSubscription(evt);
  if (!sub) return;

  db.upsertSubscription({ ...sub, status: 'canceled' });

  const recip = getVenueEmail(sub);
  if (recip) {
    sendSubscriptionCanceledEmail(recip.email, { venueName: recip.venueName })
      .catch((e) => console.warn('[SUB WEBHOOK] cancel email failed:', e.message));
  }
}

function handleChargeSucceeded(evt) {
  const sub = findSubscription(evt);
  if (!sub) {
    // Money moved at the provider and we cannot place it — that must be loud.
    console.error(JSON.stringify({
      t: new Date().toISOString(),
      msg: 'subscription-charge-unmatched',
      providerSubscriptionId: evt.providerSubscriptionId || null,
      reference: evt.reference || null,
      amountGrossZar: evt.amountGrossZar ?? null,
      rawEvent: evt.rawEvent,
    }));
    return;
  }

  const now = Date.now();
  const isActivation = sub.status === 'incomplete';
  const expectedZar = subscriptionAmountZar();

  // ── Amount guard ──
  // Providers that report the charged amount (PayFast amount_gross) must match
  // what we bill: the activation event may be 0 (free-trial card tokenization)
  // or the full fee (no-trial signup); every renewal must be the full fee.
  // On mismatch we refuse to activate/extend — the venue does not get service
  // for money that didn't arrive, and the discrepancy is logged for ops.
  if (evt.amountGrossZar !== undefined && Number.isFinite(evt.amountGrossZar)) {
    const allowed = isActivation ? [0, expectedZar] : [expectedZar];
    if (!allowed.includes(evt.amountGrossZar)) {
      console.error(JSON.stringify({
        t: new Date().toISOString(),
        msg: 'subscription-amount-guard-rejected',
        venueCode: sub.venueCode,
        isActivation,
        expectedZar,
        receivedZar: evt.amountGrossZar,
        providerSubscriptionId: evt.providerSubscriptionId || null,
        rawEvent: evt.rawEvent,
      }));
      return;
    }
  }

  // Next charge date from the provider when it's in the future (PayFast
  // billing_date: trial end on activation, next debit on renewal); otherwise a
  // conservative month. Never lets a stale provider date shrink the period to
  // the past, which would instantly expire a paying venue.
  const periodEnd = evt.nextPaymentDate && evt.nextPaymentDate > now
    ? evt.nextPaymentDate
    : now + 30 * 24 * 60 * 60 * 1000;

  if (isActivation) {
    // First verified event for this subscription — this IS the activation for
    // webhook-activated providers. Persist the provider's durable token so
    // every later event matches directly by id.
    //
    // Trial detection: a 0-amount activation is a card tokenization — the
    // venue has paid nothing yet, and billing_date (nextPaymentDate) is the
    // trial end. A paid activation is NOT a trial regardless of dates: money
    // moved, service starts as 'active'.
    const paidActivation = Number.isFinite(evt.amountGrossZar) && evt.amountGrossZar > 0;
    const trialEndsAt = sub.trialEndsAt
      || (!paidActivation && evt.nextPaymentDate && evt.nextPaymentDate > now ? evt.nextPaymentDate : null);
    const trialActive = !paidActivation && trialEndsAt && trialEndsAt > now;

    db.upsertSubscription({
      ...sub,
      providerSubscriptionId: evt.providerSubscriptionId || sub.providerSubscriptionId,
      status: trialActive ? 'trialing' : 'active',
      trialEndsAt: trialEndsAt || sub.trialEndsAt,
      currentPeriodEnd: periodEnd,
    });

    const recip = getVenueEmail(sub);
    if (recip && trialActive) {
      sendTrialStartedEmail(recip.email, {
        venueName: recip.venueName,
        trialEndsAt,
        amountZar: expectedZar,
      }).catch((e) => console.warn('[SUB WEBHOOK] trial-started email failed:', e.message));
    }
    return;
  }

  db.upsertSubscription({
    ...sub,
    // A renewal can still be the first event carrying the durable token (e.g.
    // the activation ITN was lost) — capture it whenever present.
    providerSubscriptionId: evt.providerSubscriptionId || sub.providerSubscriptionId,
    status: 'active',
    // Never SHRINK a paid-for period: a re-delivered or out-of-order event
    // must not cut service the venue already paid for.
    currentPeriodEnd: Math.max(periodEnd, sub.currentPeriodEnd || 0),
  });

  const recip = getVenueEmail(sub);
  if (recip) {
    sendSubscriptionReceiptEmail(recip.email, {
      venueName: recip.venueName,
      amountZar: expectedZar,
      nextPaymentDate: periodEnd,
    }).catch((e) => console.warn('[SUB WEBHOOK] receipt email failed:', e.message));
  }
}

function handlePaymentFailed(evt) {
  const sub = findSubscription(evt);
  if (!sub) return;

  db.upsertSubscription({ ...sub, status: 'past_due' });

  const recip = getVenueEmail(sub);
  if (recip) {
    sendSubscriptionPaymentFailedEmail(recip.email, {
      venueName: recip.venueName,
      amountZar: subscriptionAmountZar(),
    }).catch((e) => console.warn('[SUB WEBHOOK] payment-failed email failed:', e.message));
  }
}

module.exports = { subscriptionWebhook };
