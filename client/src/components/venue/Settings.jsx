import { useState, useEffect } from 'react';
import api from '../../utils/api';
import Button from '../shared/Button';

export default function Settings({ venueCode, onSaved }) {
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

  return (
    <div className="bg-dark-800 rounded-2xl border border-dark-600 p-6">
      <h2 className="text-lg font-bold mb-4">Settings</h2>
      <form onSubmit={handleSubmit} className="space-y-5">
        <label className="flex items-center gap-3 min-h-touch cursor-pointer">
          <input
            type="checkbox"
            checked={allowExplicit}
            onChange={(e) => setAllowExplicit(e.target.checked)}
            className="rounded border-dark-500 text-brand-500 focus:ring-brand-500"
          />
          <span>Allow explicit content</span>
        </label>
        <div>
          <label className="block text-sm font-medium text-dark-400 mb-2">Max songs per user</label>
          <input
            type="number"
            min={1}
            max={10}
            value={maxSongsPerUser}
            onChange={(e) => setMaxSongsPerUser(Number(e.target.value))}
            className="w-full min-h-touch px-4 py-3 bg-dark-700 border border-dark-600 rounded-xl text-white focus:ring-2 focus:ring-brand-500"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-dark-400 mb-2">
            Genre filters (comma-separated, leave empty for all)
          </label>
          <input
            type="text"
            value={genreFilters}
            onChange={(e) => setGenreFilters(e.target.value)}
            placeholder="e.g. amapiano, house, hip-hop"
            className="w-full min-h-touch px-4 py-3 bg-dark-700 border border-dark-600 rounded-xl text-white placeholder-dark-500 focus:ring-2 focus:ring-brand-500"
          />
        </div>
        <div className="border-t border-dark-600 pt-5 space-y-4">
          <h3 className="font-semibold">Venue Player</h3>
          <label className="flex items-center gap-3 min-h-touch cursor-pointer">
            <input
              type="checkbox"
              checked={autoplayQueue}
              onChange={(e) => setAutoplayQueue(e.target.checked)}
              className="rounded border-dark-500 text-brand-500 focus:ring-brand-500"
            />
            <span>Autoplay queue (auto-advance and play next song)</span>
          </label>
        </div>
        <div className="border-t border-dark-600 pt-5 space-y-4">
          <h3 className="font-semibold">Pay to play</h3>
          <label className="flex items-center gap-3 min-h-touch cursor-pointer">
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
              <label className="block text-sm font-medium text-dark-400 mb-2">Price per request (R)</label>
              <input
                type="number"
                min={5}
                max={50}
                value={requestPriceCents / 100}
                onChange={(e) => setRequestPriceCents(Math.round(Number(e.target.value) * 100) || 1000)}
                className="w-24 min-h-touch px-4 py-3 bg-dark-700 border border-dark-600 rounded-xl text-white focus:ring-2 focus:ring-brand-500"
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
