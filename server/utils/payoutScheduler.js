const db = require('./database');

/**
 * In-process payout generator.
 *
 * `generateMonthlyPayouts` was manual-only: if nobody clicked the button for a
 * given month, that month's revenue never became a payout record, so it showed
 * up nowhere — not in the owner's "who do I owe" view, not on the venue's
 * dashboard. The venue would see R0 owed and it would look correct. That is a
 * silent money-loss path, so generation now runs automatically.
 *
 * Design notes:
 *  - Runs hourly and generates for any *closed* month that has revenue but no
 *    payout rows yet, walking back CATCHUP_MONTHS. That backfill is the point:
 *    a server that was down for the whole first week of a month still produces
 *    the previous month's payouts when it comes back.
 *  - `generateMonthlyPayouts` already skips venues that have a payout for that
 *    month (UNIQUE(venue_code, year, month)), so repeated runs are harmless.
 *  - The current month is never generated — it is not finished, and a payout
 *    row written mid-month would under-count the venue's earnings.
 *
 * Env:
 *   PAYOUT_SCHEDULER_ENABLED  '0' disables; unset → on in production, off in dev
 *   PAYOUT_CATCHUP_MONTHS     how many closed months to backfill (default 6)
 */

const CHECK_INTERVAL_MS = 60 * 60 * 1000; // hourly
const INITIAL_DELAY_MS = 2 * 60 * 1000; // 2 min after boot
const DEFAULT_CATCHUP_MONTHS = 6;

function isEnabled(env = process.env) {
  const raw = env.PAYOUT_SCHEDULER_ENABLED;
  if (raw !== undefined && String(raw).trim() !== '') return String(raw).trim() !== '0';
  return env.NODE_ENV === 'production';
}

function resolveCatchupMonths(env = process.env) {
  const n = parseInt(env.PAYOUT_CATCHUP_MONTHS, 10);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_CATCHUP_MONTHS;
}

/**
 * Generate payouts for every closed month in the catch-up window that doesn't
 * have them yet. Safe to call repeatedly.
 * @returns {{monthsChecked:number, created:number, months:Array}}
 */
function runPayoutGeneration({ database = db, env = process.env, now = new Date() } = {}) {
  const catchup = resolveCatchupMonths(env);
  const summary = { monthsChecked: 0, created: 0, months: [] };

  // Start at the previous month — the current one is still open.
  for (let back = 1; back <= catchup; back++) {
    const d = new Date(now.getFullYear(), now.getMonth() - back, 1);
    const year = d.getFullYear();
    const month = d.getMonth() + 1;
    summary.monthsChecked++;

    try {
      const created = database.generateMonthlyPayouts(year, month);
      if (created > 0) {
        summary.created += created;
        summary.months.push({ year, month, created });
        console.log(JSON.stringify({
          t: new Date().toISOString(),
          msg: 'payouts-generated',
          monthLabel: `${year}-${String(month).padStart(2, '0')}`,
          created,
        }));
      }
    } catch (err) {
      // One bad month must not stop the rest of the backfill.
      console.error(JSON.stringify({
        t: new Date().toISOString(),
        msg: 'payout-generation-failed',
        monthLabel: `${year}-${String(month).padStart(2, '0')}`,
        error: err?.message,
      }));
    }
  }

  return summary;
}

/**
 * Start the scheduler. Returns a handle with stop(), or null when disabled.
 */
function startPayoutScheduler({ database = db, env = process.env } = {}) {
  if (!isEnabled(env)) {
    console.log(JSON.stringify({
      t: new Date().toISOString(),
      msg: 'payout-scheduler-disabled',
      hint: 'set PAYOUT_SCHEDULER_ENABLED=1 to enable outside production',
    }));
    return null;
  }

  let running = false;
  function tick() {
    if (running) return;
    running = true;
    try {
      runPayoutGeneration({ database, env });
    } finally {
      running = false;
    }
  }

  let interval = null;
  const initialTimer = setTimeout(() => {
    tick();
    interval = setInterval(tick, CHECK_INTERVAL_MS);
  }, INITIAL_DELAY_MS);

  console.log(JSON.stringify({
    t: new Date().toISOString(),
    msg: 'payout-scheduler-started',
    catchupMonths: resolveCatchupMonths(env),
  }));

  return {
    stop() {
      clearTimeout(initialTimer);
      if (interval) clearInterval(interval);
    },
  };
}

module.exports = {
  startPayoutScheduler,
  runPayoutGeneration,
  isEnabled,
  resolveCatchupMonths,
  CHECK_INTERVAL_MS,
};
