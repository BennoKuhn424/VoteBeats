import { useState, useEffect, useMemo } from 'react';
import { Users, Loader2, Pencil, Check, ShieldCheck } from 'lucide-react';
import api from '../../utils/api';

/**
 * Dashboard card: everything that governs what patrons can request.
 *
 * Deliberately simple (rewritten 2026-06-11): just the controls a venue owner
 * actually uses — a Family-friendly toggle (hides/blocks explicit songs via
 * Apple's content rating), a Genre restriction, a per-user limit, and the
 * pay-to-play revenue lever. The old explicit-mode/strict/blocked-words/
 * lyric-scan machinery was removed — it was confusing and the lyric scan made
 * search take minutes. Family-friendly now uses Apple's explicit flag, which
 * is instant and accurate.
 */
export default function UserRequestsCard({ venueCode, onSaved }) {
  const [maxSongsPerUser, setMaxSongsPerUser] = useState(3);
  const [familyFriendly, setFamilyFriendly] = useState(false);
  const [genres, setGenres] = useState(''); // comma-separated text in the input
  const [requirePaymentForRequest, setRequirePaymentForRequest] = useState(false);
  const [requestPriceCents, setRequestPriceCents] = useState(1000);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const [isEditing, setIsEditing] = useState(false);

  useEffect(() => {
    if (!venueCode) return;
    setLoading(true);
    api
      .getVenue(venueCode)
      .then((res) => {
        const s = res.data?.settings || {};
        setMaxSongsPerUser(s.maxSongsPerUser ?? 3);
        // Treat the legacy "allowExplicit === false" as family-friendly too, so
        // existing venues keep their intent after the migration.
        setFamilyFriendly(s.familyFriendly === true || s.allowExplicit === false);
        setGenres(Array.isArray(s.genreFilters) ? s.genreFilters.join(', ') : '');
        setRequirePaymentForRequest(s.requirePaymentForRequest ?? false);
        setRequestPriceCents(s.requestPriceCents ?? 1000);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [venueCode]);

  const genreList = useMemo(
    () => genres.split(',').map((g) => g.trim()).filter(Boolean),
    [genres]
  );

  async function handleSave(e) {
    e.preventDefault();
    setSaving(true);
    try {
      await api.updateSettings(venueCode, {
        maxSongsPerUser: Math.max(1, Math.min(10, maxSongsPerUser)) || 3,
        familyFriendly,
        genreFilters: genreList,
        requirePaymentForRequest,
        requestPriceCents: Math.max(500, Math.min(5000, requestPriceCents)) || 1000,
      });
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 2000);
      setIsEditing(false);
      onSaved?.();
    } catch (err) {
      console.error(err);
    }
    setSaving(false);
  }

  // Glanceable status chips for the collapsed view.
  const chips = useMemo(() => {
    const items = [
      { key: 'max', label: `Max ${maxSongsPerUser}/user`, tone: 'neutral' },
      familyFriendly
        ? { key: 'ff', label: 'Family-friendly', tone: 'safe' }
        : { key: 'ff', label: 'Explicit allowed', tone: 'warn' },
      requirePaymentForRequest
        ? { key: 'pay', label: `R${(requestPriceCents / 100).toFixed(0)} per request`, tone: 'revenue' }
        : { key: 'pay', label: 'Free to request', tone: 'neutral' },
    ];
    if (genreList.length > 0) {
      items.push({
        key: 'genre',
        label: `Only: ${genreList.join(', ')}`,
        tone: 'safe',
      });
    }
    return items;
  }, [maxSongsPerUser, familyFriendly, requirePaymentForRequest, requestPriceCents, genreList]);

  const chipClass = (tone) => {
    if (tone === 'revenue') return 'bg-brand-50 text-brand-700 dark:bg-brand-500/10 dark:text-brand-300 border border-brand-200/60 dark:border-brand-500/30';
    if (tone === 'warn') return 'bg-amber-50 text-amber-800 dark:bg-amber-500/10 dark:text-amber-300 border border-amber-200/60 dark:border-amber-500/30';
    if (tone === 'safe') return 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300 border border-emerald-200/60 dark:border-emerald-500/30';
    return 'bg-zinc-100 text-zinc-700 dark:bg-dark-700 dark:text-zinc-200 border border-zinc-200 dark:border-dark-600';
  };

  return (
    <div className="mb-6 p-6 bg-white dark:bg-dark-800 rounded-xl border border-zinc-200 dark:border-dark-600 shadow-sm">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex items-start gap-3 min-w-0 flex-1">
          <div className="p-2 bg-violet-100 dark:bg-violet-500/20 rounded-lg shrink-0">
            <Users className="h-5 w-5 text-violet-600 dark:text-violet-400" />
          </div>
          <div className="min-w-0">
            <h3 className="text-sm font-medium text-zinc-600 dark:text-zinc-300 uppercase tracking-wide mb-1">
              User requests
            </h3>
            <p className="text-sm text-zinc-500 dark:text-zinc-400 max-w-xl">
              What patrons can request — family-friendly filtering, genre limits,
              per-user limit, and pay-to-play.
            </p>
            {!loading && !isEditing && chips.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {chips.map((c) => (
                  <span
                    key={c.key}
                    className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium ${chipClass(c.tone)}`}
                  >
                    {c.label}
                  </span>
                ))}
              </div>
            )}
            {savedFlash && !isEditing && (
              <div className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700 dark:text-emerald-300">
                <Check className="h-3.5 w-3.5" /> Saved
              </div>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {loading ? (
            <Loader2 className="h-6 w-6 text-violet-500 animate-spin" />
          ) : isEditing ? (
            <>
              <button
                type="button"
                onClick={() => setIsEditing(false)}
                className="inline-flex items-center justify-center text-sm font-semibold px-4 py-2.5 rounded-lg border border-zinc-300 dark:border-dark-600 text-zinc-700 dark:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-dark-700 transition-colors min-h-[44px]"
              >
                Cancel
              </button>
              <button
                type="submit"
                form="user-requests-form"
                disabled={saving}
                className="inline-flex items-center justify-center gap-2 text-sm font-semibold px-4 py-2.5 rounded-lg bg-brand-500 text-white hover:bg-brand-600 transition-colors min-h-[44px] disabled:opacity-50"
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Save
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => setIsEditing(true)}
              className="inline-flex items-center justify-center gap-2 text-sm font-semibold px-4 py-2.5 rounded-lg bg-brand-500 text-white hover:bg-brand-600 transition-colors min-h-[44px]"
            >
              <Pencil className="h-4 w-4 shrink-0" />
              Edit
            </button>
          )}
        </div>
      </div>

      {!loading && isEditing && (
        <form id="user-requests-form" onSubmit={handleSave} className="mt-6 pt-6 border-t border-zinc-100 dark:border-dark-600 space-y-6">
          {/* Family-friendly — the headline toggle */}
          <div className={`rounded-xl border p-4 transition-colors ${
            familyFriendly
              ? 'border-emerald-300/70 dark:border-emerald-500/40 bg-emerald-50/60 dark:bg-emerald-500/5'
              : 'border-zinc-200 dark:border-dark-600 bg-zinc-50/60 dark:bg-dark-900/40'
          }`}>
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={familyFriendly}
                onChange={(e) => setFamilyFriendly(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-zinc-300 dark:border-dark-500 text-emerald-600 focus:ring-emerald-500"
              />
              <span className="flex-1 min-w-0">
                <span className="flex items-center gap-2 flex-wrap">
                  <ShieldCheck className="h-4 w-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                  <strong className="text-sm text-zinc-900 dark:text-zinc-100">Family-friendly mode</strong>
                </span>
                <span className="block text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
                  Explicit songs (per Apple's content rating) can't be requested. Patrons
                  still see them in search, marked "not family-friendly," so they know why.
                </span>
              </span>
            </label>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            {/* Max songs per user */}
            <div>
              <label htmlFor="ur-max-songs" className="block text-sm font-semibold text-zinc-800 dark:text-zinc-100 mb-1">
                Max songs per user
              </label>
              <p className="text-xs text-zinc-500 dark:text-zinc-400 mb-2">
                How many tracks one device can queue.
              </p>
              <input
                id="ur-max-songs"
                type="number"
                min={1}
                max={10}
                value={maxSongsPerUser}
                onChange={(e) => setMaxSongsPerUser(Number(e.target.value))}
                className="w-full sm:w-28 min-h-touch px-3 py-2 rounded-lg border border-zinc-300 dark:border-dark-600 bg-white dark:bg-dark-700 text-zinc-900 dark:text-zinc-100 focus:ring-2 focus:ring-brand-500 focus:border-brand-500"
              />
            </div>

            {/* Genre restriction (moved here from Settings) */}
            <div>
              <label htmlFor="ur-genres" className="block text-sm font-semibold text-zinc-800 dark:text-zinc-100 mb-1">
                Genre filter
              </label>
              <p className="text-xs text-zinc-500 dark:text-zinc-400 mb-2">
                Only let patrons request these genres. Comma-separated. Leave empty for all.
              </p>
              <input
                id="ur-genres"
                type="text"
                value={genres}
                onChange={(e) => setGenres(e.target.value)}
                placeholder="e.g. Afrikaans"
                className="w-full min-h-touch px-3 py-2 rounded-lg border border-zinc-300 dark:border-dark-600 bg-white dark:bg-dark-700 text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 dark:placeholder-zinc-500 focus:ring-2 focus:ring-brand-500 focus:border-brand-500"
              />
            </div>
          </div>

          {/* Pay-to-play — the revenue lever */}
          <div className={`rounded-xl border p-4 transition-colors ${
            requirePaymentForRequest
              ? 'border-brand-300/70 dark:border-brand-500/40 bg-brand-50/60 dark:bg-brand-500/5'
              : 'border-zinc-200 dark:border-dark-600 bg-zinc-50/60 dark:bg-dark-900/40'
          }`}>
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={requirePaymentForRequest}
                onChange={(e) => setRequirePaymentForRequest(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-zinc-300 dark:border-dark-500 text-brand-500 focus:ring-brand-500"
              />
              <span className="flex-1 min-w-0">
                <span className="flex items-center justify-between gap-2 flex-wrap">
                  <strong className="text-sm text-zinc-900 dark:text-zinc-100">Require payment to request a song</strong>
                  {requirePaymentForRequest && (
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-brand-500 text-white text-[11px] font-bold uppercase tracking-wide">
                      Revenue on
                    </span>
                  )}
                </span>
                <span className="block text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
                  Patrons pay before their request is added. Needs YOCO_SECRET_KEY on the server.
                </span>
              </span>
            </label>
            {requirePaymentForRequest && (
              <div className="mt-3 pl-7 flex items-end gap-3 flex-wrap">
                <div>
                  <label htmlFor="ur-price" className="block text-xs font-semibold text-zinc-700 dark:text-zinc-200 mb-1.5">
                    Price per request
                  </label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500 dark:text-zinc-400 font-semibold text-sm pointer-events-none">R</span>
                    <input
                      id="ur-price"
                      type="number"
                      min={5}
                      max={50}
                      step={1}
                      value={requestPriceCents / 100}
                      onChange={(e) => setRequestPriceCents(Math.round(Number(e.target.value) * 100) || 1000)}
                      className="w-28 min-h-touch pl-7 pr-3 py-2 rounded-lg border border-zinc-300 dark:border-dark-600 bg-white dark:bg-dark-700 text-zinc-900 dark:text-zinc-100 focus:ring-2 focus:ring-brand-500 focus:border-brand-500 font-semibold"
                    />
                  </div>
                </div>
                <div className="flex flex-wrap gap-1.5 pb-1">
                  {[5, 10, 20, 50].map((amount) => (
                    <button
                      key={amount}
                      type="button"
                      onClick={() => setRequestPriceCents(amount * 100)}
                      className={`px-2.5 py-1.5 rounded-full text-xs font-semibold transition-colors min-h-[32px] ${
                        requestPriceCents === amount * 100
                          ? 'bg-brand-500 text-white'
                          : 'bg-white dark:bg-dark-700 border border-zinc-300 dark:border-dark-600 text-zinc-600 dark:text-zinc-300 hover:border-brand-400'
                      }`}
                    >
                      R{amount}
                    </button>
                  ))}
                </div>
                <p className="basis-full text-[11px] text-zinc-400 dark:text-zinc-500">R5–R50 per request.</p>
              </div>
            )}
          </div>
        </form>
      )}
    </div>
  );
}
