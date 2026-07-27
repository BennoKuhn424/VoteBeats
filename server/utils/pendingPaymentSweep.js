const db = require('./database');
const { getProvider } = require('../providers/payment');
const { fulfillPaidRequest } = require('./paymentFulfill');

/**
 * Safe sweep of abandoned checkouts.
 *
 * The naive version of this was a bare `DELETE FROM pending_payments WHERE
 * created_at < cutoff`, which loses money: if the patron paid but the webhook
 * never landed (provider outage, dropped delivery, server restart mid-request),
 * the pending row is the only remaining link between that payment and the
 * venue. Deleting it means the money sits in the provider account with no
 * `payments` row, so it never reaches a payout and the venue is never credited
 * — silently, with nothing in the UI to reveal it.
 *
 * So before deleting anything we ask the provider whether each stale checkout
 * was actually paid:
 *   - paid, amount matches   → fulfil it now (late, but correct)
 *   - paid, amount mismatch  → park in orphaned_payments for manual handling
 *   - genuinely unpaid       → safe to delete, patron abandoned checkout
 *   - provider unreachable   → KEEP the row and retry next sweep
 *
 * The last case matters: an unverifiable row is never deleted, so a provider
 * outage delays cleanup rather than destroying the audit trail.
 */

/** Checkouts younger than this are left alone — the webhook may still arrive. */
const DEFAULT_MAX_AGE_MS = 60 * 60 * 1000; // 1 hour

/**
 * @returns {Promise<{checked:number, fulfilled:number, deleted:number, orphaned:number, kept:number}>}
 */
async function sweepStalePendingPayments({
  maxAgeMs = DEFAULT_MAX_AGE_MS,
  database = db,
  provider = null,
  fulfill = fulfillPaidRequest,
} = {}) {
  const stats = { checked: 0, fulfilled: 0, deleted: 0, orphaned: 0, kept: 0 };

  const stale = database.getStalePendingPayments(maxAgeMs) || [];
  if (stale.length === 0) return stats;

  const activeProvider = provider || getProvider();

  // Without a configured provider we cannot prove anything was unpaid, and
  // deleting on that basis is exactly the money-losing behaviour we're fixing.
  if (!activeProvider.isConfigured()) {
    stats.kept = stale.length;
    console.warn(JSON.stringify({
      t: new Date().toISOString(),
      msg: 'pending-sweep-skipped-provider-unconfigured',
      kept: stale.length,
    }));
    return stats;
  }

  for (const pending of stale) {
    stats.checked++;
    const { checkoutId, venueCode, amountCents } = pending;

    let verified = false;
    let providerAmount = null;
    try {
      const result = await activeProvider.verifyCheckout(checkoutId);
      verified = Boolean(result?.verified);
      providerAmount = result?.amountCents ?? null;
    } catch (err) {
      // Unreachable provider — keep the row, try again next sweep.
      stats.kept++;
      console.warn(JSON.stringify({
        t: new Date().toISOString(),
        msg: 'pending-sweep-verify-failed',
        checkoutId,
        error: err?.message,
      }));
      continue;
    }

    if (!verified) {
      // Provider confirms no payment — the patron abandoned checkout.
      database.removePendingPayment(checkoutId);
      stats.deleted++;
      continue;
    }

    // Paid. Only fulfil when the amount matches what we asked for; otherwise
    // park it rather than guessing.
    if (Number.isFinite(providerAmount) && Number.isFinite(amountCents) && providerAmount === amountCents) {
      try {
        await fulfill(checkoutId, providerAmount);
        stats.fulfilled++;
        console.log(JSON.stringify({
          t: new Date().toISOString(),
          msg: 'pending-sweep-late-fulfilled',
          checkoutId,
          venueCode,
          amountCents: providerAmount,
        }));
      } catch (err) {
        database.recordOrphanedPayment({
          checkoutId,
          venueCode,
          amountCents: providerAmount,
          reason: 'fulfil_failed',
          detail: { error: err?.message },
        });
        database.removePendingPayment(checkoutId);
        stats.orphaned++;
      }
      continue;
    }

    // Paid, but the amount does not match — never silently absorb this.
    database.recordOrphanedPayment({
      checkoutId,
      venueCode,
      amountCents: Number.isFinite(providerAmount) ? providerAmount : null,
      reason: 'amount_mismatch',
      detail: { expectedCents: amountCents, providerCents: providerAmount },
    });
    database.removePendingPayment(checkoutId);
    stats.orphaned++;
    console.error(JSON.stringify({
      t: new Date().toISOString(),
      msg: 'pending-sweep-orphaned',
      checkoutId,
      venueCode,
      expectedCents: amountCents,
      providerCents: providerAmount,
    }));
  }

  if (stats.fulfilled || stats.orphaned || stats.deleted || stats.kept) {
    console.log(JSON.stringify({
      t: new Date().toISOString(),
      msg: 'pending-sweep-complete',
      ...stats,
    }));
  }
  return stats;
}

module.exports = { sweepStalePendingPayments, DEFAULT_MAX_AGE_MS };
