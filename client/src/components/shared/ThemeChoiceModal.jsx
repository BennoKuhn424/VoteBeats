import { useTheme } from '../../context/ThemeContext';
import { Sun, Moon } from 'lucide-react';

/**
 * Shown once after first login when the user hasn't picked a theme yet.
 * Mounts inside the venue layout so it only applies to logged-in venues.
 * The choice is persisted locally immediately and to the server best-effort.
 */
export default function ThemeChoiceModal() {
  const { needsChoice, setTheme } = useTheme();

  if (!needsChoice) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-md rounded-2xl bg-white dark:bg-dark-800 border border-zinc-200 dark:border-dark-600 shadow-2xl p-6">
        <h2 className="text-xl font-bold text-zinc-900 dark:text-zinc-100 mb-1">Pick your look</h2>
        <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-5">
          You can switch any time from Settings.
        </p>
        <div className="grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={() => setTheme('light')}
            className="flex flex-col items-center gap-3 rounded-xl border-2 border-zinc-200 hover:border-brand-500 p-5 transition-colors bg-white text-zinc-900"
          >
            <Sun className="h-8 w-8 text-amber-500" />
            <span className="font-semibold">Light</span>
            <span className="text-xs text-zinc-500">Bright, crisp dashboard</span>
          </button>
          <button
            type="button"
            onClick={() => setTheme('dark')}
            className="flex flex-col items-center gap-3 rounded-xl border-2 border-dark-600 hover:border-brand-500 p-5 transition-colors bg-dark-900 text-zinc-100"
          >
            <Moon className="h-8 w-8 text-brand-400" />
            <span className="font-semibold">Dark</span>
            <span className="text-xs text-zinc-400">Easy on the eyes at night</span>
          </button>
        </div>
      </div>
    </div>
  );
}
