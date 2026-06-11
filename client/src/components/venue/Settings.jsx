import { Sun, Moon } from 'lucide-react';
import Button from '../shared/Button';
import { useTheme } from '../../context/ThemeContext';

/**
 * General venue settings — appearance only.
 *
 * Patron-facing request controls (family-friendly, genre filter, per-user
 * limit, pay-to-play) all live in the User Requests dashboard card. The genre
 * filter moved there 2026-06-11 so every request rule sits in one place.
 */
export default function Settings({ onSaved, variant = 'dark' }) {
  const { theme, setTheme } = useTheme();

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
        family-friendly mode, genre limits, pricing, and per-user limits.
      </p>
      <div className="space-y-5">
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
        <Button type="button" onClick={() => onSaved?.()} className="w-full">
          Done
        </Button>
      </div>
    </div>
  );
}
