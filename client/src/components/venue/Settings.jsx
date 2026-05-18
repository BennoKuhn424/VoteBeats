import { useState, useEffect } from 'react';
import { Sun, Moon } from 'lucide-react';
import api from '../../utils/api';
import Button from '../shared/Button';
import { useTheme } from '../../context/ThemeContext';

/**
 * General venue settings.
 *
 * After the random-autoplay removal (2026-05-18), patron-facing controls
 * (max-per-user, pay-to-play, explicit, blocked words, lyric scan) live in
 * the User Requests dashboard card. This modal keeps only generic settings:
 * appearance and the request genre filter.
 */
export default function Settings({ venueCode, onSaved, variant = 'dark' }) {
  const [genreFilters, setGenreFilters] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const { theme, setTheme } = useTheme();

  useEffect(() => {
    if (!venueCode) return;
    api
      .getVenue(venueCode)
      .then((res) => {
        const s = res.data?.settings || {};
        setGenreFilters(Array.isArray(s.genreFilters) ? s.genreFilters.join(', ') : '');
      })
      .catch(console.error);
  }, [venueCode]);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setSaving(true);
    try {
      await api.updateSettings(venueCode, {
        genreFilters: genreFilters
          ? genreFilters.split(',').map((g) => g.trim()).filter(Boolean)
          : [],
      });
      onSaved?.();
    } catch (err) {
      console.error(err);
      setError(err.response?.data?.error || 'Failed to save settings');
    } finally {
      setSaving(false);
    }
  }

  const isLight = variant === 'light';
  const cardClass = isLight
    ? 'bg-white rounded-xl border border-zinc-200 shadow-sm p-6'
    : 'bg-dark-800 rounded-2xl border border-dark-600 p-6';

  return (
    <div className={cardClass}>
      <h2 className={`text-lg font-bold mb-2 ${isLight ? 'text-zinc-900' : ''}`}>Settings</h2>
      <p className={`text-sm mb-4 ${isLight ? 'text-zinc-500' : 'text-dark-400'}`}>
        Use <strong className={isLight ? 'text-zinc-700' : 'text-dark-200'}>Playlists &amp; schedule</strong> for
        libraries and time slots, and <strong className={isLight ? 'text-zinc-700' : 'text-dark-200'}>User requests</strong> for
        pricing, per-user limits, and content rules.
      </p>
      <form onSubmit={handleSubmit} className="space-y-5">
        <div>
          <label className={`block text-sm font-medium mb-2 ${isLight ? 'text-zinc-600' : 'text-dark-400'}`}>Appearance</label>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setTheme('light')}
              className={`flex items-center justify-center gap-2 min-h-touch rounded-xl border-2 px-4 py-3 text-sm font-semibold transition-colors ${
                theme === 'light'
                  ? 'border-brand-500 bg-brand-50 text-brand-700'
                  : isLight
                    ? 'border-zinc-300 bg-white text-zinc-700 hover:border-zinc-400'
                    : 'border-dark-600 bg-dark-700 text-dark-200 hover:border-dark-500'
              }`}
            >
              <Sun className="h-4 w-4" /> Light
            </button>
            <button
              type="button"
              onClick={() => setTheme('dark')}
              className={`flex items-center justify-center gap-2 min-h-touch rounded-xl border-2 px-4 py-3 text-sm font-semibold transition-colors ${
                theme === 'dark'
                  ? 'border-brand-500 bg-brand-500/10 text-brand-400'
                  : isLight
                    ? 'border-zinc-300 bg-white text-zinc-700 hover:border-zinc-400'
                    : 'border-dark-600 bg-dark-700 text-dark-200 hover:border-dark-500'
              }`}
            >
              <Moon className="h-4 w-4" /> Dark
            </button>
          </div>
        </div>
        <div>
          <label className={`block text-sm font-medium mb-1 ${isLight ? 'text-zinc-600' : 'text-dark-400'}`}>
            Request genre filter
          </label>
          <p className={`text-xs mb-2 ${isLight ? 'text-zinc-400' : 'text-dark-500'}`}>
            Limits what genres customers can search and request. Leave empty to allow all genres.
          </p>
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
        {error && <p className="text-red-500 text-sm">{error}</p>}
        <Button type="submit" disabled={saving} className="w-full">
          {saving ? 'Saving...' : 'Save settings'}
        </Button>
      </form>
    </div>
  );
}
