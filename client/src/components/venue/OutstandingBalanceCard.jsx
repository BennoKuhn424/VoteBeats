import { useState, useEffect, useCallback } from 'react';
import { Banknote, Clock, CheckCircle2 } from 'lucide-react';
import api from '../../utils/api';

/**
 * "What Speeldit still owes this venue" card.
 *
 * Complements EarningsCard, which shows the current month's takings. That money
 * is not payable yet — it only becomes owed once the month is closed off into a
 * payout record. This card shows the settled-but-unpaid side, which can span
 * several months, so the two figures are deliberately kept visually separate.
 *
 * Failed payouts still count as outstanding: the transfer never landed, so the
 * venue is still owed the money.
 */
function formatRand(value) {
  const n = Number.isFinite(Number(value)) ? Number(value) : 0;
  return `R${n.toFixed(2)}`;
}

export default function OutstandingBalanceCard({ venueCode, embedded }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState(false);

  const fetchOutstanding = useCallback(async () => {
    if (!venueCode) return;
    try {
      const res = await api.getVenueOutstanding(venueCode);
      setData(res.data);
      setFetchError(false);
    } catch {
      setData(null);
      setFetchError(true);
    } finally {
      setLoading(false);
    }
  }, [venueCode]);

  useEffect(() => {
    fetchOutstanding();
    // Payout status changes when the owner marks a transfer — slower poll than
    // earnings, which move with every paid request.
    const interval = setInterval(fetchOutstanding, 60000);
    return () => clearInterval(interval);
  }, [fetchOutstanding]);

  const cardClass = embedded
    ? ''
    : 'bg-white dark:bg-dark-800 rounded-xl border border-zinc-200 dark:border-dark-600 shadow-sm p-6';

  const Header = ({ children }) => (
    <div className="flex items-start gap-3">
      <div className="p-2 bg-emerald-50 dark:bg-emerald-500/15 rounded-lg shrink-0">
        <Banknote className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
      </div>
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  );

  if (loading) {
    return (
      <div className={cardClass}>
        <Header>
          <div className="h-3.5 bg-zinc-200 dark:bg-dark-600 rounded w-40 mb-2 animate-pulse" />
          <div className="h-8 bg-zinc-200 dark:bg-dark-600 rounded w-32 animate-pulse" />
        </Header>
      </div>
    );
  }

  if (fetchError && !data) {
    return (
      <div className={cardClass}>
        <Header>
          <h3 className="text-sm font-medium text-zinc-600 dark:text-zinc-300 uppercase tracking-wide mb-1">
            Awaiting payout
          </h3>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            Could not load balance.{' '}
            <button
              onClick={fetchOutstanding}
              className="text-brand-600 dark:text-brand-400 hover:underline font-medium"
            >
              Retry
            </button>
          </p>
        </Header>
      </div>
    );
  }

  const outstandingCents = data?.outstandingCents || 0;
  const unpaidMonths = data?.unpaidMonths || 0;
  const months = data?.months || [];
  const hasOutstanding = outstandingCents > 0;

  return (
    <div className={cardClass}>
      <Header>
        <h3 className="text-sm font-medium text-zinc-600 dark:text-zinc-300 uppercase tracking-wide mb-1">
          Awaiting payout
        </h3>
        <p
          className={`text-3xl font-bold tabular-nums leading-tight ${
            hasOutstanding
              ? 'text-emerald-600 dark:text-emerald-400'
              : 'text-zinc-400 dark:text-zinc-500'
          }`}
        >
          {formatRand(outstandingCents / 100)}
        </p>

        {hasOutstanding ? (
          <>
            <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
              {unpaidMonths} month{unpaidMonths === 1 ? '' : 's'} awaiting transfer
            </p>
            <ul className="mt-3 space-y-1">
              {months.map((m) => (
                <li
                  key={m.id}
                  className="flex items-center justify-between text-xs text-zinc-600 dark:text-zinc-400"
                >
                  <span className="flex items-center gap-1.5">
                    <Clock className="h-3 w-3 text-zinc-400 dark:text-zinc-500 shrink-0" />
                    {m.monthLabel}
                    {m.status === 'failed' && (
                      <span className="text-amber-600 dark:text-amber-400 font-medium">
                        · retry pending
                      </span>
                    )}
                  </span>
                  <span className="tabular-nums font-medium text-zinc-700 dark:text-zinc-300">
                    {formatRand((m.venueAmountCents || 0) / 100)}
                  </span>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1 flex items-center gap-1.5">
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
            All settled — nothing outstanding
          </p>
        )}

        {data?.thisMonth?.venueAmountCents > 0 && (
          <p className="text-xs text-zinc-500 dark:text-zinc-500 mt-3 pt-3 border-t border-zinc-100 dark:border-dark-600">
            {formatRand((data.thisMonth.venueAmountCents || 0) / 100)} earned in{' '}
            {data.thisMonth.monthLabel} — paid out after month end
          </p>
        )}
      </Header>
    </div>
  );
}
