const db = require('./database');

/**
 * Internal ledger self-check.
 *
 * This does NOT talk to the payment provider — see the note at the bottom on
 * why full provider-side reconciliation can't be done from here. What it does
 * is verify that our two internal money records stay consistent with each
 * other and internally sound, catching silent corruption (a bad migration, a
 * hand-edited row, a partial write) before it turns into a wrong payout.
 *
 * Checks per closed month:
 *  - every payout's venue+platform split sums to its gross (rounding-exact)
 *  - every payout's stored gross equals the sum of that venue's payment rows
 *  - no negative amounts anywhere
 *  - no duplicate payout for the same venue+month (the UNIQUE constraint should
 *    prevent this, but we assert it rather than assume it)
 *
 * Anything that fails is logged loudly and returned, so it can drive an alert
 * or a dashboard badge rather than being discovered when a venue disputes a
 * transfer.
 */

/**
 * Run the integrity check across a window of closed months.
 * @returns {{checkedMonths:number, checkedPayouts:number, problems:Array}}
 */
function checkLedgerIntegrity({ database = db, monthsBack = 6, now = new Date() } = {}) {
  const problems = [];
  let checkedPayouts = 0;
  let checkedMonths = 0;

  for (let back = 1; back <= monthsBack; back++) {
    const d = new Date(now.getFullYear(), now.getMonth() - back, 1);
    const year = d.getFullYear();
    const month = d.getMonth() + 1;
    const monthLabel = `${year}-${String(month).padStart(2, '0')}`;
    checkedMonths++;

    let payouts;
    try {
      payouts = database.getAllPayoutsForMonth(year, month) || [];
    } catch (err) {
      problems.push({ monthLabel, kind: 'read_failed', detail: err?.message });
      continue;
    }

    const seenVenues = new Set();

    for (const p of payouts) {
      checkedPayouts++;

      // Duplicate venue+month.
      if (seenVenues.has(p.venueCode)) {
        problems.push({ monthLabel, venueCode: p.venueCode, payoutId: p.id, kind: 'duplicate_payout' });
      }
      seenVenues.add(p.venueCode);

      // Negative amounts.
      if (p.grossCents < 0 || p.venueAmountCents < 0 || p.platformAmountCents < 0) {
        problems.push({ monthLabel, venueCode: p.venueCode, payoutId: p.id, kind: 'negative_amount' });
      }

      // Split must sum to gross, exactly (integer cents).
      if ((p.venueAmountCents || 0) + (p.platformAmountCents || 0) !== (p.grossCents || 0)) {
        problems.push({
          monthLabel,
          venueCode: p.venueCode,
          payoutId: p.id,
          kind: 'split_mismatch',
          detail: {
            grossCents: p.grossCents,
            venueAmountCents: p.venueAmountCents,
            platformAmountCents: p.platformAmountCents,
          },
        });
      }

      // Stored gross must equal the raw payments it claims to summarize.
      let actualGross = null;
      try {
        actualGross = (database.getVenueEarningsForMonth(p.venueCode, year, month) || {}).grossCents || 0;
      } catch (err) {
        problems.push({ monthLabel, venueCode: p.venueCode, payoutId: p.id, kind: 'earnings_read_failed', detail: err?.message });
      }
      if (actualGross !== null && actualGross !== (p.grossCents || 0)) {
        problems.push({
          monthLabel,
          venueCode: p.venueCode,
          payoutId: p.id,
          kind: 'gross_drift',
          detail: { recordedGrossCents: p.grossCents, actualGrossCents: actualGross },
        });
      }
    }
  }

  const result = { checkedMonths, checkedPayouts, problems };

  if (problems.length > 0) {
    console.error(JSON.stringify({
      t: new Date().toISOString(),
      msg: 'ledger-integrity-problems',
      problemCount: problems.length,
      problems,
    }));
  } else {
    console.log(JSON.stringify({
      t: new Date().toISOString(),
      msg: 'ledger-integrity-ok',
      checkedMonths,
      checkedPayouts,
    }));
  }

  return result;
}

module.exports = { checkLedgerIntegrity };

/*
 * NOTE ON PROVIDER-SIDE RECONCILIATION
 * ------------------------------------
 * True end-to-end safety would also compare our `payments` table against Yoco's
 * own record of money received (their settlement report), to catch a payment
 * that happened but that we never learned about at all. That is deliberately
 * NOT implemented here: the PatronPaymentProvider interface exposes only
 * per-checkout verification (verifyCheckout), not a bulk "list all settled
 * payments in a date range" call, and Yoco's Checkout API has no generic export
 * we can rely on across providers. Building it against a guessed endpoint would
 * be worse than not having it. The correct place for it is a new provider
 * method (e.g. listSettlements(from,to)) implemented against Yoco's reporting
 * API — a real, scoped piece of work, flagged rather than faked.
 */
