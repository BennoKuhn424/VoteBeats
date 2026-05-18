import { useState, useEffect, useMemo } from 'react';
import { Users, Loader2, Pencil, Check } from 'lucide-react';
import api from '../../utils/api';

/**
 * Dashboard card: everything that governs what patrons can do.
 * Replaces the old "Play random" card after random autoplay was removed
 * 2026-05-18. Consolidates pricing, per-user limits, profanity / blocked
 * words, lyric scan, and explicit rules into one place so venue owners
 * don't have to hunt across Settings to find patron-facing controls.
 */
export default function UserRequestsCard({ venueCode, onSaved }) {
  // Patron limits
  const [maxSongsPerUser, setMaxSongsPerUser] = useState(3);
  // Pay-to-play
  const [requirePaymentForRequest, setRequirePaymentForRequest] = useState(false);
  const [requestPriceCents, setRequestPriceCents] = useState(1000);
  // Explicit content
  const [explicitMode, setExplicitMode] = useState('off');
  const [explicitAfterHour, setExplicitAfterHour] = useState(18);
  const [strictExplicit, setStrictExplicit] = useState(false);
  // Word filter
  const [blockedTitleWords, setBlockedTitleWords] = useState([]);
  const [wordInput, setWordInput] = useState('');
  // Lyrics scan
  const [lyricsFilter, setLyricsFilter] = useState(false);
  const [lyricsThreshold, setLyricsThreshold] = useState(3);
  const [lyricsLanguages, setLyricsLanguages] = useState(['en']);

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
        setRequirePaymentForRequest(s.requirePaymentForRequest ?? false);
        setRequestPriceCents(s.requestPriceCents ?? 1000);
        if (typeof s.explicitAfterHour === 'number') {
          setExplicitMode('scheduled');
          setExplicitAfterHour(s.explicitAfterHour);
        } else {
          setExplicitMode(s.allowExplicit ? 'always' : 'off');
        }
        setStrictExplicit(s.strictExplicit === true);
        setBlockedTitleWords(Array.isArray(s.blockedTitleWords) ? s.blockedTitleWords : []);
        setLyricsFilter(s.lyricsFilter === true);
        setLyricsThreshold(Number.isFinite(s.lyricsThreshold) ? s.lyricsThreshold : 3);
        setLyricsLanguages(Array.isArray(s.lyricsLanguages) ? s.lyricsLanguages : ['en']);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [venueCode]);

  function addWord(raw) {
    const w = (raw || '').trim();
    if (!w) return;
    const key = w.toLowerCase();
    setBlockedTitleWords((prev) => (
      prev.some((x) => x.toLowerCase() === key) ? prev : [...prev, w]
    ));
    setWordInput('');
  }

  function removeWord(word) {
    setBlockedTitleWords((prev) => prev.filter((w) => w !== word));
  }

  const explicitSummary = useMemo(() => {
    if (explicitMode === 'off') return 'Never';
    if (explicitMode === 'always') return 'Always';
    return `After ${String(explicitAfterHour).padStart(2, '0')}:00`;
  }, [explicitMode, explicitAfterHour]);

  async function handleSave(e) {
    e.preventDefault();
    setSaving(true);
    try {
      await api.updateSettings(venueCode, {
        maxSongsPerUser: Math.max(1, Math.min(10, maxSongsPerUser)) || 3,
        requirePaymentForRequest,
        requestPriceCents: Math.max(500, Math.min(5000, requestPriceCents)) || 1000,
        allowExplicit: explicitMode === 'always',
        explicitAfterHour: explicitMode === 'scheduled' ? explicitAfterHour : null,
        strictExplicit,
        blockedTitleWords,
        lyricsFilter,
        lyricsThreshold,
        lyricsLanguages,
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

  // Status chips for the collapsed view — reads like a glanceable dashboard
  // instead of a label/value spec sheet.
  const chips = useMemo(() => {
    const items = [
      { key: 'max', label: `Max ${maxSongsPerUser}/user`, tone: 'neutral' },
      requirePaymentForRequest
        ? { key: 'pay', label: `R${(requestPriceCents / 100).toFixed(0)} per request`, tone: 'revenue' }
        : { key: 'pay', label: 'Free to request', tone: 'neutral' },
      {
        key: 'explicit',
        label: `Explicit: ${explicitSummary}${strictExplicit && explicitMode !== 'always' ? ' · strict' : ''}`,
        tone: explicitMode === 'always' ? 'warn' : 'safe',
      },
    ];
    if (blockedTitleWords.length > 0) {
      items.push({
        key: 'words',
        label: `${blockedTitleWords.length} blocked word${blockedTitleWords.length === 1 ? '' : 's'}`,
        tone: 'safe',
      });
    }
    if (lyricsFilter) {
      const langs = lyricsLanguages.length > 0 ? lyricsLanguages.map((l) => l.toUpperCase()).join('+') : 'custom';
      items.push({
        key: 'lyrics',
        label: `Lyric scan ${lyricsThreshold}+ · ${langs}`,
        tone: 'safe',
      });
    }
    return items;
  }, [
    maxSongsPerUser, requirePaymentForRequest, requestPriceCents,
    explicitMode, explicitSummary, strictExplicit,
    blockedTitleWords.length, lyricsFilter, lyricsThreshold, lyricsLanguages,
  ]);

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
              Everything that controls what patrons can request — per-user limits, pay-to-play
              pricing, blocked words, and explicit content policy.
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
          {/* Patron limits + Explicit — sibling controls in a 2-col grid on desktop */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
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

            <div>
              <label className="block text-sm font-semibold text-zinc-800 dark:text-zinc-100 mb-1">
                Explicit content
              </label>
              <p className="text-xs text-zinc-500 dark:text-zinc-400 mb-2">
                When patrons can request explicit songs.
              </p>
              <div className="flex flex-wrap gap-1.5">
                {[
                  { id: 'off', label: 'Never' },
                  { id: 'always', label: 'Always' },
                  { id: 'scheduled', label: 'After hour' },
                ].map(({ id, label }) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setExplicitMode(id)}
                    className={`px-3.5 py-1.5 rounded-full text-xs font-semibold transition-colors min-h-[36px] ${
                      explicitMode === id
                        ? 'bg-brand-500 text-white'
                        : 'bg-zinc-100 dark:bg-dark-700 text-zinc-600 dark:text-zinc-300 hover:text-zinc-900 dark:hover:text-white'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {explicitMode === 'scheduled' && (
                <div className="flex items-center gap-2 mt-2">
                  <span className="text-xs text-zinc-600 dark:text-zinc-300">Allow after</span>
                  <select
                    value={explicitAfterHour}
                    onChange={(e) => setExplicitAfterHour(Number(e.target.value))}
                    className="min-h-touch px-3 py-2 rounded-lg border border-zinc-300 dark:border-dark-600 bg-white dark:bg-dark-700 text-zinc-900 dark:text-zinc-100 focus:ring-2 focus:ring-brand-500 text-sm"
                  >
                    {Array.from({ length: 24 }, (_, i) => (
                      <option key={i} value={i}>{`${i.toString().padStart(2, '0')}:00`}</option>
                    ))}
                  </select>
                </div>
              )}
              {explicitMode !== 'always' && (
                <label className="mt-2.5 flex items-start gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={strictExplicit}
                    onChange={(e) => setStrictExplicit(e.target.checked)}
                    className="mt-0.5 h-4 w-4 rounded border-zinc-300 dark:border-dark-500 text-brand-500 focus:ring-brand-500"
                  />
                  <span className="text-xs text-zinc-600 dark:text-zinc-300">
                    <strong className="text-zinc-800 dark:text-zinc-100">Strict mode</strong>
                    <span className="block text-zinc-500 dark:text-zinc-400">
                      Drop unrated songs too. Safer; may shrink results.
                    </span>
                  </span>
                </label>
              )}
            </div>
          </div>

          {/* Pay-to-play — promoted to its own accent panel since it's the revenue lever */}
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

          {/* Word filter + lyric scan */}
          <div className="rounded-xl border border-zinc-200 dark:border-dark-600 bg-zinc-50/60 dark:bg-dark-900/40 p-4">
            <label className="block text-sm font-semibold text-zinc-800 dark:text-zinc-100 mb-1">Blocked words</label>
            <p className="text-xs text-zinc-500 dark:text-zinc-400 mb-3">
              Songs whose title or artist contain any of these words are hidden from customer search.
            </p>
            {blockedTitleWords.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mb-2">
                {blockedTitleWords.map((w) => (
                  <button
                    key={w}
                    type="button"
                    onClick={() => removeWord(w)}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-red-100 dark:bg-red-500/20 text-red-700 dark:text-red-300 text-xs font-medium hover:bg-red-200 dark:hover:bg-red-500/30"
                  >
                    {w}
                    <span className="text-red-500/80 dark:text-red-300/80 text-[10px]">✕</span>
                  </button>
                ))}
              </div>
            )}
            <div className="flex gap-2 mb-3">
              <input
                type="text"
                value={wordInput}
                onChange={(e) => setWordInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ',') {
                    e.preventDefault();
                    addWord(wordInput);
                  }
                }}
                placeholder="Add a word and press Enter"
                maxLength={50}
                className="flex-1 min-h-touch px-3 py-2 rounded-lg border border-zinc-300 dark:border-dark-600 bg-white dark:bg-dark-700 text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 dark:placeholder-zinc-500 text-sm focus:ring-2 focus:ring-brand-500 focus:border-brand-500"
              />
              <button
                type="button"
                onClick={() => addWord(wordInput)}
                disabled={!wordInput.trim()}
                className="px-4 py-2 rounded-lg bg-brand-500 text-white text-sm font-semibold hover:bg-brand-600 transition-colors disabled:opacity-50 min-h-touch"
              >
                Add
              </button>
            </div>

            <div className="pt-3 border-t border-zinc-200 dark:border-dark-600">
              <label className="flex items-start gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={lyricsFilter}
                  onChange={(e) => setLyricsFilter(e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-zinc-300 dark:border-dark-500 text-brand-500 focus:ring-brand-500"
                />
                <span className="text-sm text-zinc-700 dark:text-zinc-200">
                  <strong className="text-zinc-900 dark:text-zinc-100">Also scan lyrics</strong>
                  <span className="block text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
                    Catches songs where the words appear in the lyrics, not just the title or artist. Uses your words above plus a built-in profanity list. Adds ~1&nbsp;second to the first search for a song; cached after that.
                  </span>
                </span>
              </label>
              {lyricsFilter && (
                <div className="mt-3 pl-6 space-y-3">
                  <div>
                    <p className="text-xs font-semibold text-zinc-700 dark:text-zinc-200 mb-1.5">
                      Block when lyrics contain…
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {[
                        { v: 1, label: '1+ hits', sub: 'strictest' },
                        { v: 3, label: '3+ hits', sub: 'recommended' },
                        { v: 5, label: '5+ hits', sub: 'lenient' },
                      ].map(({ v, label, sub }) => (
                        <button
                          key={v}
                          type="button"
                          onClick={() => setLyricsThreshold(v)}
                          className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-colors min-h-[36px] ${
                            lyricsThreshold === v
                              ? 'bg-brand-500 text-white'
                              : 'bg-white dark:bg-dark-700 border border-zinc-300 dark:border-dark-600 text-zinc-600 dark:text-zinc-300 hover:border-brand-400'
                          }`}
                        >
                          {label} <span className={`text-[10px] font-normal ${lyricsThreshold === v ? 'text-white/80' : 'text-zinc-400 dark:text-zinc-500'}`}>· {sub}</span>
                        </button>
                      ))}
                    </div>
                    <p className="text-[11px] text-zinc-400 dark:text-zinc-500 mt-1.5">
                      Lower = stricter. At 1+, even one swear word drops the song — many popular songs will disappear. 3+ is a good balance.
                    </p>
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-zinc-700 dark:text-zinc-200 mb-1.5">
                      Built-in profanity list
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {[
                        { id: 'en', label: 'English' },
                        { id: 'af', label: 'Afrikaans' },
                      ].map(({ id, label }) => {
                        const on = lyricsLanguages.includes(id);
                        return (
                          <button
                            key={id}
                            type="button"
                            onClick={() => {
                              setLyricsLanguages((prev) => (
                                prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
                              ));
                            }}
                            className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-colors min-h-[36px] ${
                              on
                                ? 'bg-brand-500 text-white'
                                : 'bg-white dark:bg-dark-700 border border-zinc-300 dark:border-dark-600 text-zinc-600 dark:text-zinc-300 hover:border-brand-400'
                            }`}
                          >
                            {label}
                          </button>
                        );
                      })}
                    </div>
                    <p className="text-[11px] text-zinc-400 dark:text-zinc-500 mt-1.5">
                      Pick none to scan only with your custom words above. Songs without lyrics on LRCLIB are kept (or dropped if strict mode is on).
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </form>
      )}
    </div>
  );
}
