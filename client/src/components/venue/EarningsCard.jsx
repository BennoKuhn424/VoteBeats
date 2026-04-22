import { useState, useEffect } from 'react';
import { DollarSign } from 'lucide-react';
import api from '../../utils/api';

export default function EarningsCard({ venueCode, showPlaceholder, variant = 'dark', embedded }) {
  const [earnings, setEarnings] = useState(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState(false);

  useEffect(() => {
    if (!venueCode) return;
    fetchEarnings();
    const interval = setInterval(fetchEarnings, 10000);
    return () => clearInterval(interval);
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

  const isLight = variant === 'light';
  const cardClass = embedded
    ? ''
    : isLight
      ? 'bg-white rounded-xl border border-zinc-200 shadow-sm p-6'
      : 'bg-dark-800 rounded-2xl border border-dark-600 p-6';

  if (loading) {
    return (
      <div className={cardClass}>
        {isLight && (
          <div className="flex items-start gap-3 mb-4">
            <div className="p-2 bg-orange-100 rounded-lg">
              <DollarSign className="h-5 w-5 text-brand-600" />
            </div>
            <div className="flex-1">
              <div className="h-4 bg-zinc-200 rounded w-32 mb-2" />
              <div className="h-8 bg-zinc-200 rounded w-24" />
            </div>
          </div>
        )}
        {!isLight && (
          <>
            <div className="h-5 bg-dark-600 rounded w-1/2 mb-4" />
            <div className="h-8 bg-dark-600 rounded w-1/3" />
          </>
        )}
      </div>
    );
  }

  if (fetchError && !earnings) {
    return (
      <div className={cardClass}>
        <p className={`text-sm ${isLight ? 'text-zinc-500' : 'text-dark-400'}`}>
          Could not load earnings.{' '}
          <button onClick={fetchEarnings} className="text-brand-500 hover:text-brand-400 underline">
            Retry
          </button>
        </p>
      </div>
    );
  }

  if (showPlaceholder) {
    return (
      <div className={cardClass}>
        {isLight && (
          <div className="flex items-start gap-3 mb-4">
            <div className="p-2 bg-orange-100 rounded-lg">
              <DollarSign className="h-5 w-5 text-brand-600" />
            </div>
            <div className="flex-1">
              <h3 className="text-sm font-medium text-zinc-600 uppercase tracking-wide mb-1">
                Pay-to-play earnings
              </h3>
              <p className="text-sm text-zinc-500">
                Enable &quot;Require payment to suggest a song&quot; in Settings to track earnings.
              </p>
            </div>
          </div>
        )}
        {!isLight && (
          <>
            <h3 className="text-sm font-medium text-dark-400 uppercase tracking-wide mb-2">
              Pay-to-play earnings
            </h3>
            <p className="text-dark-400 text-sm">
              Enable &quot;Require payment to suggest a song&quot; in Settings to track earnings.
            </p>
          </>
        )}
      </div>
    );
  }

  const grossRand = parseFloat(earnings?.grossRand || 0);
  const venueShareRand = parseFloat(earnings?.venueShareRand || 0);
  const hasEarnings = grossRand > 0;
  const paymentsCount = earnings?.paymentsCount || 0;

  if (isLight) {
    return (
      <div className={cardClass}>
        <div className="flex items-start gap-3 mb-4">
          <div className="p-2 bg-orange-100 rounded-lg">
            <DollarSign className="h-5 w-5 text-brand-600" />
          </div>
          <div className="flex-1">
            <h3 className="text-sm font-medium text-zinc-600 uppercase tracking-wide mb-1">
              Pay-to-play earnings
            </h3>
            <p className="text-3xl font-bold text-brand-600">R {venueShareRand.toFixed(2)}</p>
          </div>
        </div>
        <div className="text-sm text-zinc-600 space-y-1">
          <p>This month: {paymentsCount} paid requests</p>
          {hasEarnings && (
            <p className="text-zinc-500">
              Gross: R{grossRand.toFixed(2)} (70% venue share)
            </p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className={cardClass}>
      <h3 className="text-sm font-medium text-dark-400 uppercase tracking-wide mb-2">
        Pay-to-play earnings
      </h3>
      <p className="text-3xl font-extrabold text-brand-400">R {venueShareRand.toFixed(2)}</p>
      <p className="text-sm text-dark-400 mt-1">
        This month • {paymentsCount} paid requests
      </p>
      {hasEarnings && (
        <p className="text-xs text-dark-500 mt-2">
          Gross: R{grossRand.toFixed(2)} (70% venue share)
        </p>
      )}
    </div>
  );
}
