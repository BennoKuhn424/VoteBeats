import { useState, useEffect } from 'react';
import api from '../../utils/api';
import Button from '../shared/Button';

export default function Settings({ venueCode, onSaved, variant = 'dark' }) {
  const [allowExplicit, setAllowExplicit] = useState(false);
  const [maxSongsPerUser, setMaxSongsPerUser] = useState(3);
  const [genreFilters, setGenreFilters] = useState('');
  const [requirePaymentForRequest, setRequirePaymentForRequest] = useState(false);
  const [requestPriceCents, setRequestPriceCents] = useState(1000);
  const [autoplayQueue, setAutoplayQueue] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!venueCode) return;
    api
      .getVenue(venueCode)
      .then((res) => {
        const s = res.data?.settings || {};
        setAllowExplicit(s.allowExplicit ?? false);
        setMaxSongsPerUser(s.maxSongsPerUser ?? 3);
        setGenreFilters(Array.isArray(s.genreFilters) ? s.genreFilters.join(', ') : '');
        setRequirePaymentForRequest(s.requirePaymentForRequest ?? false);
        setRequestPriceCents(s.requestPriceCents ?? 1000);
        setAutoplayQueue(s.autoplayQueue ?? true);
      })
      .catch(console.error);
  }, [venueCode]);

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true);
    try {
      await api.updateSettings(venueCode, {
        allowExplicit,
        maxSongsPerUser: Math.max(1, Math.min(10, maxSongsPerUser)) || 3,
        genreFilters: genreFilters
          ? genreFilters.split(',').map((g) => g.trim()).filter(Boolean)
          : [],
        requirePaymentForRequest,
        requestPriceCents: Math.max(500, Math.min(5000, requestPriceCents)) || 1000,
        autoplayQueue,
      });
      onSaved?.();
    } catch (err) {
      console.error(err);
    }
    setSaving(false);
  }

  const isLight = variant === 'light';
  const cardClass = isLight
    ? 'bg-white rounded-xl border border-zinc-200 shadow-sm p-6'
    : 'bg-dark-800 rounded-2xl border border-dark-600 p-6';

  return (
    <div className={cardClass}>
      <h2 className={`text-lg font-bold mb-4 ${isLight ? 'text-zinc-900' : ''}`}>Settings</h2>
      <form onSubmit={handleSubmit} className="space-y-5">
        <label className={`flex items-center gap-3 min-h-touch cursor-pointer ${isLight ? 'text-zinc-700' : ''}`}>
          <input
            type="checkbox"
            checked={allowExplicit}
            onChange={(e) => setAllowExplicit(e.target.checked)}
            className="rounded border-dark-500 text-brand-500 focus:ring-brand-500"
          />
          <span>Allow explicit content</span>
        </label>
        <div>
          <label className={`block text-sm font-medium mb-2 ${isLight ? 'text-zinc-600' : 'text-dark-400'}`}>Max songs per user</label>
          <input
            type="number"
            min={1}
            max={10}
            value={maxSongsPerUser}
            onChange={(e) => setMaxSongsPerUser(Number(e.target.value))}
            className={`w-full min-h-touch px-4 py-3 rounded-xl focus:ring-2 focus:ring-brand-500 ${
              isLight ? 'bg-white border border-zinc-300 text-zinc-900' : 'bg-dark-700 border border-dark-600 text-white'
            }`}
          />
        </div>
        <div>
          <label className={`block text-sm font-medium mb-2 ${isLight ? 'text-zinc-600' : 'text-dark-400'}`}>
            Genre filters (comma-separated, leave empty for all)
          </label>
          <input
            type="text"
            value={genreFilters}
            onChange={(e) => setGenreFilters(e.target.value)}
            placeholder="e.g. amapiano, house, hip-hop"
            className={`w-full min-h-touch px-4 py-3 rounded-xl focus:ring-2 focus:ring-brand-500 ${
              isLight ? 'bg-white border border-zinc-300 text-zinc-900 placeholder-zinc-400' : 'bg-dark-700 border border-dark-600 text-white placeholder-dark-500'
            }`}
          />
        </div>
        <div className={`border-t pt-5 space-y-4 ${isLight ? 'border-zinc-200' : 'border-dark-600'}`}>
          <h3 className={`font-semibold ${isLight ? 'text-zinc-900' : ''}`}>Venue Player</h3>
          <label className={`flex items-center gap-3 min-h-touch cursor-pointer ${isLight ? 'text-zinc-700' : ''}`}>
            <input
              type="checkbox"
              checked={autoplayQueue}
              onChange={(e) => setAutoplayQueue(e.target.checked)}
              className="rounded border-dark-500 text-brand-500 focus:ring-brand-500"
            />
            <span>Autoplay queue (auto-advance and play next song)</span>
          </label>
        </div>
        <div className={`border-t pt-5 space-y-4 ${isLight ? 'border-zinc-200' : 'border-dark-600'}`}>
          <h3 className={`font-semibold ${isLight ? 'text-zinc-900' : ''}`}>Pay to play</h3>
          <label className={`flex items-center gap-3 min-h-touch cursor-pointer ${isLight ? 'text-zinc-700' : ''}`}>
            <input
              type="checkbox"
              checked={requirePaymentForRequest}
              onChange={(e) => setRequirePaymentForRequest(e.target.checked)}
              className="rounded border-dark-500 text-brand-500 focus:ring-brand-500"
            />
            <span>Require payment to suggest a song</span>
          </label>
          {requirePaymentForRequest && (
            <div>
              <label className={`block text-sm font-medium mb-2 ${isLight ? 'text-zinc-600' : 'text-dark-400'}`}>Price per request (R)</label>
              <input
                type="number"
                min={5}
                max={50}
                value={requestPriceCents / 100}
                onChange={(e) => setRequestPriceCents(Math.round(Number(e.target.value) * 100) || 1000)}
                className={`w-24 min-h-touch px-4 py-3 rounded-xl focus:ring-2 focus:ring-brand-500 ${
                  isLight ? 'bg-white border border-zinc-300 text-zinc-900' : 'bg-dark-700 border border-dark-600 text-white'
                }`}
              />
              <p className="text-xs text-dark-500 mt-1">R5–R50. Add YOCO_SECRET_KEY on the server to enable.</p>
            </div>
          )}
        </div>
        <Button type="submit" disabled={saving} className="w-full">
          {saving ? 'Saving...' : 'Save settings'}
        </Button>
      </form>
    </div>
  );
}
