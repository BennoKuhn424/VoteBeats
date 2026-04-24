import { useState, useEffect, useMemo } from 'react';
import { Shuffle, Loader2, Pencil, ChevronDown } from 'lucide-react';
import api from '../../utils/api';
import { AUTOPLAY_GENRE_SECTIONS } from '../../data/autoplayGenreSections';

function GenreSection({ label, selectedCount, items, autoplayGenres, onToggle }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mb-2 border border-zinc-200 dark:border-dark-600 rounded-lg overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-3 py-2.5 bg-zinc-50 dark:bg-dark-900 hover:bg-zinc-100 dark:hover:bg-dark-700 transition-colors"
      >
        <span className="text-xs font-semibold uppercase tracking-wide text-zinc-600 dark:text-zinc-300">
          {label}
          {selectedCount > 0 && (
            <span className="ml-1.5 inline-flex items-center justify-center px-1.5 py-0.5 rounded-full bg-violet-600 text-white text-[10px] font-bold leading-none normal-case">
              {selectedCount}
            </span>
          )}
        </span>
        <ChevronDown className={`w-4 h-4 text-zinc-400 dark:text-zinc-500 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="max-h-44 overflow-y-auto p-2 grid grid-cols-3 sm:grid-cols-4 gap-1.5">
          {items.map((g) => (
            <button
              key={g}
              type="button"
              onClick={() => onToggle(g)}
              className={`px-2 py-1.5 rounded-lg text-xs font-medium border transition-colors text-center truncate ${
                autoplayGenres.includes(g)
                  ? 'bg-violet-600 text-white border-violet-600'
                  : 'bg-white dark:bg-dark-700 text-zinc-700 dark:text-zinc-200 border-zinc-200 dark:border-dark-600 hover:bg-zinc-100 dark:hover:bg-dark-600'
              }`}
            >
              {g}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Dashboard card: explicit rules + genre/language mix for Random autoplay.
 * (Not in Settings — lives next to Playlists & schedule.)
 */
export default function RandomAutoplayCard({
  venueCode,
  effectiveAutoplayMode,
  onSaved,
}) {
  const [explicitMode, setExplicitMode] = useState('off');
  const [explicitAfterHour, setExplicitAfterHour] = useState(18);
  const [strictExplicit, setStrictExplicit] = useState(false);
  const [blockedTitleWords, setBlockedTitleWords] = useState([]);
  const [wordInput, setWordInput] = useState('');
  const [autoplayGenres, setAutoplayGenres] = useState([]);
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
        if (typeof s.explicitAfterHour === 'number') {
          setExplicitMode('scheduled');
          setExplicitAfterHour(s.explicitAfterHour);
        } else {
          setExplicitMode(s.allowExplicit ? 'always' : 'off');
        }
        setStrictExplicit(s.strictExplicit === true);
        setBlockedTitleWords(Array.isArray(s.blockedTitleWords) ? s.blockedTitleWords : []);
        const ag = s.autoplayGenre;
        setAutoplayGenres(Array.isArray(ag) ? ag : (ag ? [ag] : []));
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

  function toggleGenre(g) {
    setAutoplayGenres((prev) =>
      prev.includes(g) ? prev.filter((x) => x !== g) : [...prev, g],
    );
  }

  const summaryGenres = useMemo(() => {
    if (autoplayGenres.length === 0) return 'Any style (no filter)';
    if (autoplayGenres.length <= 4) return autoplayGenres.join(', ');
    return `${autoplayGenres.slice(0, 4).join(', ')} +${autoplayGenres.length - 4} more`;
  }, [autoplayGenres]);

  const explicitSummary = useMemo(() => {
    if (explicitMode === 'off') return 'Never';
    if (explicitMode === 'always') return 'Always allowed';
    return `After ${String(explicitAfterHour).padStart(2, '0')}:00`;
  }, [explicitMode, explicitAfterHour]);

  async function handleSave(e) {
    e.preventDefault();
    setSaving(true);
    try {
      await api.updateSettings(venueCode, {
        allowExplicit: explicitMode === 'always',
        explicitAfterHour: explicitMode === 'scheduled' ? explicitAfterHour : null,
        strictExplicit,
        blockedTitleWords,
        autoplayGenre: autoplayGenres.length > 0 ? autoplayGenres : null,
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

  return (
    <div className="mb-6 p-6 bg-white dark:bg-dark-800 rounded-xl border border-zinc-200 dark:border-dark-600 shadow-sm">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex items-start gap-3 min-w-0 flex-1">
          <div className="p-2 bg-violet-100 dark:bg-violet-500/20 rounded-lg shrink-0">
            <Shuffle className="h-5 w-5 text-violet-600 dark:text-violet-400" />
          </div>
          <div className="min-w-0">
            <h3 className="text-sm font-medium text-zinc-600 dark:text-zinc-300 uppercase tracking-wide mb-1">
              Play random
            </h3>
            <p className="text-sm text-zinc-500 dark:text-zinc-400 max-w-xl">
              Choose genres and languages for random autofill, and set explicit rules for what can play and
              appear in search. Use the top player bar to switch autoplay to <strong className="text-zinc-700 dark:text-zinc-100">Random</strong>.
            </p>
            {effectiveAutoplayMode === 'random' && (
              <div className="mt-3 max-w-xl rounded-lg border border-violet-100 dark:border-violet-900/40 bg-violet-50/90 dark:bg-violet-950/30 px-3 py-2.5 text-sm">
                <span className="text-zinc-600 dark:text-zinc-300">Autoplay is on </span>
                <span className="font-semibold text-zinc-800 dark:text-zinc-100">random</span>
                <span className="text-zinc-600 dark:text-zinc-300"> — mix: </span>
                <span className="font-medium text-violet-800 dark:text-violet-300">{summaryGenres}</span>
              </div>
            )}
            {!loading && !isEditing && (
              <dl className="mt-3 max-w-xl text-sm space-y-1">
                <div className="flex flex-wrap gap-x-2 gap-y-0.5">
                  <dt className="text-zinc-500 dark:text-zinc-400 shrink-0">Explicit</dt>
                  <dd className="text-zinc-800 dark:text-zinc-100 font-medium">
                    {explicitSummary}
                    {strictExplicit && explicitMode !== 'always' && (
                      <span className="ml-1 text-xs text-violet-700 dark:text-violet-300">(strict)</span>
                    )}
                  </dd>
                </div>
                <div className="flex flex-wrap gap-x-2 gap-y-0.5">
                  <dt className="text-zinc-500 dark:text-zinc-400 shrink-0">Mix</dt>
                  <dd className="text-zinc-800 dark:text-zinc-100 font-medium">{summaryGenres}</dd>
                </div>
                {blockedTitleWords.length > 0 && (
                  <div className="flex flex-wrap gap-x-2 gap-y-0.5">
                    <dt className="text-zinc-500 dark:text-zinc-400 shrink-0">Blocked words</dt>
                    <dd className="text-zinc-800 dark:text-zinc-100 font-medium">
                      {blockedTitleWords.length} {blockedTitleWords.length === 1 ? 'word' : 'words'}
                    </dd>
                  </div>
                )}
              </dl>
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
                Done
              </button>
              <button
                type="submit"
                form="random-autoplay-form"
                disabled={saving}
                className="inline-flex items-center justify-center gap-2 text-sm font-semibold px-4 py-2.5 rounded-lg bg-violet-600 text-white hover:bg-violet-700 transition-colors min-h-[44px] disabled:opacity-50"
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                {savedFlash ? 'Saved' : 'Save random mix'}
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => setIsEditing(true)}
              className="inline-flex items-center justify-center gap-2 text-sm font-semibold px-4 py-2.5 rounded-lg bg-violet-600 text-white hover:bg-violet-700 transition-colors min-h-[44px]"
            >
              <Pencil className="h-4 w-4 shrink-0" />
              Edit
            </button>
          )}
        </div>
      </div>

      {!loading && isEditing && (
        <form id="random-autoplay-form" onSubmit={handleSave} className="mt-6 pt-6 border-t border-zinc-100 dark:border-dark-600 space-y-6">
          <div>
            <label className="block text-sm font-medium text-zinc-600 dark:text-zinc-300 mb-2">Explicit content</label>
            <div className="flex flex-wrap gap-2 mb-2">
              {[
                { id: 'off', label: 'Never' },
                { id: 'always', label: 'Always' },
                { id: 'scheduled', label: 'After hour' },
              ].map(({ id, label }) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setExplicitMode(id)}
                  className={`px-4 py-2 rounded-full text-xs font-semibold transition-colors min-h-[36px] ${
                    explicitMode === id
                      ? 'bg-violet-600 text-white'
                      : 'bg-zinc-100 dark:bg-dark-700 text-zinc-500 dark:text-zinc-300 hover:text-zinc-900 dark:hover:text-white'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            {explicitMode === 'scheduled' && (
              <div className="flex items-center gap-2 mt-2">
                <span className="text-sm text-zinc-600 dark:text-zinc-300">Allow after</span>
                <select
                  value={explicitAfterHour}
                  onChange={(e) => setExplicitAfterHour(Number(e.target.value))}
                  className="min-h-touch px-3 py-2 rounded-lg border border-zinc-300 dark:border-dark-600 bg-white dark:bg-dark-700 text-zinc-900 dark:text-zinc-100 focus:ring-2 focus:ring-violet-500"
                >
                  {Array.from({ length: 24 }, (_, i) => (
                    <option key={i} value={i}>{`${i.toString().padStart(2, '0')}:00`}</option>
                  ))}
                </select>
              </div>
            )}
            <p className="text-xs mt-1 text-zinc-400 dark:text-zinc-500">
              {explicitMode === 'off' && 'No explicit songs in random autofill or customer search.'}
              {explicitMode === 'always' && 'Explicit allowed at all times.'}
              {explicitMode === 'scheduled' && `Clean before ${explicitAfterHour}:00, explicit after.`}
            </p>
            {explicitMode !== 'always' && (
              <label className="mt-3 flex items-start gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={strictExplicit}
                  onChange={(e) => setStrictExplicit(e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-zinc-300 dark:border-dark-500 text-violet-600 focus:ring-violet-500"
                />
                <span className="text-xs text-zinc-600 dark:text-zinc-300">
                  <strong className="text-zinc-800 dark:text-zinc-100">Strict mode</strong>
                  <span className="block text-zinc-500 dark:text-zinc-400">
                    Also drop songs the label didn&apos;t rate (safer; may shrink results).
                  </span>
                </span>
              </label>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-zinc-600 dark:text-zinc-300 mb-1">Blocked words (title / artist)</label>
            <p className="text-xs text-zinc-400 dark:text-zinc-500 mb-2">
              Songs whose title or artist contains any of these words (whole-word match) are hidden from search and random autofill.
            </p>
            {blockedTitleWords.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mb-2">
                {blockedTitleWords.map((w) => (
                  <button
                    key={w}
                    type="button"
                    onClick={() => removeWord(w)}
                    className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-red-100 dark:bg-red-500/20 text-red-700 dark:text-red-300 text-xs font-medium hover:bg-red-200 dark:hover:bg-red-500/30"
                  >
                    {w}
                    <span className="text-red-500/80 dark:text-red-300/80 text-[10px]">✕</span>
                  </button>
                ))}
              </div>
            )}
            <div className="flex gap-2">
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
                className="flex-1 min-h-touch px-3 py-2 rounded-lg border border-zinc-300 dark:border-dark-600 bg-white dark:bg-dark-700 text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 dark:placeholder-zinc-500 text-sm focus:ring-2 focus:ring-violet-500"
              />
              <button
                type="button"
                onClick={() => addWord(wordInput)}
                disabled={!wordInput.trim()}
                className="px-4 py-2 rounded-lg bg-violet-600 text-white text-sm font-semibold hover:bg-violet-700 transition-colors disabled:opacity-50 min-h-touch"
              >
                Add
              </button>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-zinc-600 dark:text-zinc-300 mb-1">Genres &amp; languages</label>
            <p className="text-xs text-zinc-400 dark:text-zinc-500 mb-3">
              Random autoplay picks from these tags. Leave empty for a wide variety. Does not limit what customers can request
              (use Settings &rarr; request genre filter for that).
            </p>
            {autoplayGenres.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mb-3">
                {autoplayGenres.map((g) => (
                  <button
                    key={g}
                    type="button"
                    onClick={() => toggleGenre(g)}
                    className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-violet-600 text-white text-xs font-medium hover:bg-violet-700"
                  >
                    {g}
                    <span className="text-white/80 text-[10px]">✕</span>
                  </button>
                ))}
              </div>
            )}
            {AUTOPLAY_GENRE_SECTIONS.map((section) => {
              const selectedCount = section.items.filter((g) => autoplayGenres.includes(g)).length;
              return (
                <GenreSection
                  key={section.label}
                  label={section.label}
                  selectedCount={selectedCount}
                  items={section.items}
                  autoplayGenres={autoplayGenres}
                  onToggle={toggleGenre}
                />
              );
            })}
          </div>
        </form>
      )}
    </div>
  );
}
