import { useState, useEffect } from 'react';
import { Wallet } from 'lucide-react';
import api from '../../utils/api';

/**
 * Pay-to-play earnings card.
 *
 * Single render path with Tailwind `dark:` variants — replaces the older
 * dual-path implementation that drifted (dark mode lacked the icon badge,
 * had inconsistent rand formatting, mixed font weights). Currency uses
 * tabular-nums so figures of different widths align cleanly when polled.
 */
function formatRand(value) {
  const n = Number.isFinite(Number(value)) ? Number(value) : 0;
  return `R${n.toFixed(2)}`;
}

export default function EarningsCard({ venueCode, showPlaceholder, variant, embedded }) {
  const [earnings, setEarnings] = useState(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState(false);

  useEffect(() => {
    if (!venueCode) return;
    fetchEarnings();
    const interval = setInterval(fetchEarnings, 10000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [venueCode]);

  async function fetchEarnings() {
    try {
      const res = await api.getVenueEarnings(venueCode);
      setEarnings(res.data);
      setFetchError(false);
    } catch {
      setEarnings(null);
      setFetchError(true);
    } finally {
      setLoading(false);
    }
  }

  // `variant` is accepted for backwards compatibility with callers but no
  // longer branches the layout — Tailwind `dark:` variants do that automatically.
  void variant;

  const cardClass = embedded
    ? ''
    : 'bg-white dark:bg-dark-800 rounded-xl border border-zinc-200 dark:border-dark-600 shadow-sm p-6';

  const Header = ({ children }) => (
    <div className="flex items-start gap-3 mb-4">
      <div className="p-2 bg-brand-50 dark:bg-brand-500/15 rounded-lg shrink-0">
        <Wallet className="h-5 w-5 text-brand-600 dark:text-brand-400" />
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

  if (fetchError && !earnings) {
    return (
      <div className={cardClass}>
        <Header>
          <h3 className="text-sm font-medium text-zinc-600 dark:text-zinc-300 uppercase tracking-wide mb-1">
            Pay-to-play earnings
          </h3>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            Could not load earnings.{' '}
            <button onClick={fetchEarnings} className="text-brand-600 dark:text-brand-400 hover:underline font-medium">
              Retry
            </button>
          </p>
        </Header>
      </div>
    );
  }

  if (showPlaceholder) {
    return (
      <div className={cardClass}>
        <Header>
          <h3 className="text-sm font-medium text-zinc-600 dark:text-zinc-300 uppercase tracking-wide mb-1">
            Pay-to-play earnings
          </h3>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            Turn on pay-to-play in <strong className="text-zinc-700 dark:text-zinc-200">User requests</strong> to start earning per song.
          </p>
        </Header>
      </div>
    );
  }

  const grossRand = parseFloat(earnings?.grossRand || 0);
  const venueShareRand = parseFloat(earnings?.venueShareRand || 0);
  const hasEarnings = grossRand > 0;
  const paymentsCount = earnings?.paymentsCount || 0;

  return (
    <div className={cardClass}>
      <Header>
        <h3 className="text-sm font-medium text-zinc-600 dark:text-zinc-300 uppercase tracking-wide mb-1">
          Pay-to-play earnings
        </h3>
        <p className="text-3xl font-bold tabular-nums text-brand-600 dark:text-brand-400 leading-tight">
          {formatRand(venueShareRand)}
        </p>
        <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
          This month · {paymentsCount} paid request{paymentsCount === 1 ? '' : 's'}
        </p>
        {hasEarnings && (
          <p className="text-xs text-zinc-500 dark:text-zinc-500 mt-2">
            Gross <span className="tabular-nums">{formatRand(grossRand)}</span> · 70% venue share
          </p>
        )}
      </Header>
    </div>
  );
}
