import { useState, useEffect } from 'react';
import api from '../../utils/api';

export default function EarningsCard({ venueCode, showPlaceholder }) {
  const [earnings, setEarnings] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!venueCode) return;
    fetchEarnings();
    const interval = setInterval(fetchEarnings, 10000); // Refresh every 10s
    return () => clearInterval(interval);
  }, [venueCode]);

  async function fetchEarnings() {
    try {
      const res = await api.getVenueEarnings(venueCode);
      setEarnings(res.data);
    } catch {
      setEarnings(null);
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="bg-dark-800 rounded-2xl border border-dark-600 p-6 animate-pulse">
        <div className="h-5 bg-dark-600 rounded w-1/2 mb-4" />
        <div className="h-8 bg-dark-600 rounded w-1/3" />
      </div>
    );
  }

  if (showPlaceholder) {
    return (
      <div className="bg-dark-800 rounded-2xl border border-dark-600 p-6">
        <h3 className="text-sm font-medium text-dark-400 uppercase tracking-wide mb-2">Pay-to-play earnings</h3>
        <p className="text-dark-400 text-sm">Enable &quot;Require payment to suggest a song&quot; in Settings to track earnings.</p>
      </div>
    );
  }

  const grossRand = parseFloat(earnings?.grossRand || 0);
  const venueShareRand = parseFloat(earnings?.venueShareRand || 0);
  const hasEarnings = grossRand > 0;

  return (
    <div className="bg-dark-800 rounded-2xl border border-dark-600 p-6">
      <h3 className="text-sm font-medium text-dark-400 uppercase tracking-wide mb-2">
        Pay-to-play earnings
      </h3>
      <p className="text-3xl font-extrabold text-brand-400">
        R {venueShareRand.toFixed(2)}
      </p>
      <p className="text-sm text-dark-400 mt-1">
        This month • {earnings?.paymentsCount || 0} paid requests
      </p>
      {hasEarnings && (
        <p className="text-xs text-dark-500 mt-2">
          Gross: R{grossRand.toFixed(2)} (80% venue share)
        </p>
      )}
    </div>
  );
}
