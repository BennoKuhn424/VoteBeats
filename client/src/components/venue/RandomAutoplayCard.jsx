import { useState, useEffect, useMemo } from 'react';
import { Shuffle, Loader2, Pencil } from 'lucide-react';
import api from '../../utils/api';
import { AUTOPLAY_GENRE_SECTIONS } from '../../data/autoplayGenreSections';

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
        const ag = s.autoplayGenre;
        setAutoplayGenres(Array.isArray(ag) ? ag : (ag ? [ag] : []));
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [venueCode]);

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
    <div className="mb-6 p-6 bg-white rounded-xl border border-zinc-200 shadow-sm">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex items-start gap-3 min-w-0 flex-1">
          <div className="p-2 bg-violet-100 rounded-lg shrink-0">
            <Shuffle className="h-5 w-5 text-violet-600" />
          </div>
          <div className="min-w-0">
            <h3 className="text-sm font-medium text-zinc-600 uppercase tracking-wide mb-1">
              Play random
            </h3>
            <p className="text-sm text-zinc-500 max-w-xl">
              Choose genres and languages for random autofill, and set explicit rules for what can play and
              appear in search. Use the top player bar to switch autoplay to <strong className="text-zinc-700">Random</strong>.
            </p>
            {effectiveAutoplayMode === 'random' && (
              <div className="mt-3 max-w-xl rounded-lg border border-violet-100 bg-violet-50/90 px-3 py-2.5 text-sm">
                <span className="text-zinc-600">Autoplay is on </span>
                <span className="font-semibold text-zinc-800">random</span>
                <span className="text-zinc-600"> — mix: </span>
                <span className="font-medium text-violet-800">{summaryGenres}</span>
              </div>
            )}
            {!loading && !isEditing && (
              <dl className="mt-3 max-w-xl text-sm space-y-1">
                <div className="flex flex-wrap gap-x-2 gap-y-0.5">
                  <dt className="text-zinc-500 shrink-0">Explicit</dt>
                  <dd className="text-zinc-800 font-medium">{explicitSummary}</dd>
                </div>
                <div className="flex flex-wrap gap-x-2 gap-y-0.5">
                  <dt className="text-zinc-500 shrink-0">Mix</dt>
                  <dd className="text-zinc-800 font-medium">{summaryGenres}</dd>
                </div>
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
                className="inline-flex items-center justify-center text-sm font-semibold px-4 py-2.5 rounded-lg border border-zinc-300 text-zinc-700 hover:bg-zinc-50 transition-colors min-h-[44px]"
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
        <form id="random-autoplay-form" onSubmit={handleSave} className="mt-6 pt-6 border-t border-zinc-100 space-y-6">
          <div>
            <label className="block text-sm font-medium text-zinc-600 mb-2">Explicit content</label>
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
                      : 'bg-zinc-100 text-zinc-500 hover:text-zinc-900'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            {explicitMode === 'scheduled' && (
              <div className="flex items-center gap-2 mt-2">
                <span className="text-sm text-zinc-600">Allow after</span>
                <select
                  value={explicitAfterHour}
                  onChange={(e) => setExplicitAfterHour(Number(e.target.value))}
                  className="min-h-touch px-3 py-2 rounded-lg border border-zinc-300 bg-white text-zinc-900 focus:ring-2 focus:ring-violet-500"
                >
                  {Array.from({ length: 24 }, (_, i) => (
                    <option key={i} value={i}>{`${i.toString().padStart(2, '0')}:00`}</option>
                  ))}
                </select>
              </div>
            )}
            <p className="text-xs mt-1 text-zinc-400">
              {explicitMode === 'off' && 'No explicit songs in random autofill or customer search.'}
              {explicitMode === 'always' && 'Explicit allowed at all times.'}
              {explicitMode === 'scheduled' && `Clean before ${explicitAfterHour}:00, explicit after.`}
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-zinc-600 mb-1">Genres &amp; languages</label>
            <p className="text-xs text-zinc-400 mb-3">
              Random autoplay picks from these tags. Leave empty for a wide variety. Does not limit what customers can request
              (use Settings → request genre filter for that).
            </p>
            {autoplayGenres.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-3">
                {autoplayGenres.map((g) => (
                  <button
                    key={g}
                    type="button"
                    onClick={() => toggleGenre(g)}
                    className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-violet-600 text-white text-sm font-medium hover:bg-violet-700"
                  >
                    {g}
                    <span className="text-white/80 text-xs">✕</span>
                  </button>
                ))}
              </div>
            )}
            {AUTOPLAY_GENRE_SECTIONS.map((section) => (
              <div key={section.label} className="mb-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500 mb-2">
                  {section.label}
                </p>
                <div className="flex flex-wrap gap-2">
                  {section.items.map((g) => (
                    <button
                      key={g}
                      type="button"
                      onClick={() => toggleGenre(g)}
                      className={`px-3 py-1.5 rounded-full text-sm font-medium border transition-colors ${
                        autoplayGenres.includes(g)
                          ? 'bg-violet-600 text-white border-violet-600'
                          : 'bg-zinc-50 text-zinc-700 border-zinc-200 hover:bg-zinc-100'
                      }`}
                    >
                      {g}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </form>
      )}
    </div>
  );
}
