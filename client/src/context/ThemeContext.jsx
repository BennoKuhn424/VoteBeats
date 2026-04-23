import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import api from '../utils/api';

const ThemeContext = createContext(null);

const STORAGE_KEY = 'speeldit_theme';
const VALID = new Set(['light', 'dark']);

/**
 * Central theme state. Sources, in priority order:
 *   1. venue.settings.theme   (server — once auth lands)
 *   2. localStorage key       (set by first-login choice / toggle)
 *   3. null                   (never picked — triggers ThemeChoiceModal)
 *
 * The `dark` class is toggled on <html> so Tailwind's `dark:` variants work.
 * Customer voting and public pages read only localStorage; they stay dark by
 * default via an explicit `forceDark` prop on their layout.
 */

function readStoredTheme() {
  if (typeof window === 'undefined') return null;
  const t = window.localStorage.getItem(STORAGE_KEY);
  return VALID.has(t) ? t : null;
}

function applyDomTheme(theme) {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  if (theme === 'dark') root.classList.add('dark');
  else root.classList.remove('dark');
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used inside <ThemeProvider>');
  return ctx;
}

export function ThemeProvider({ children }) {
  // Start from localStorage synchronously so there's no flash on first paint.
  const [theme, setThemeState] = useState(() => readStoredTheme());
  const [needsChoice, setNeedsChoice] = useState(() => readStoredTheme() === null);

  // Apply DOM class whenever theme changes
  useEffect(() => {
    applyDomTheme(theme || 'light');
  }, [theme]);

  /** Persist a chosen theme locally + on the server (best effort). */
  const setTheme = useCallback(async (next, { persistServer = true } = {}) => {
    if (!VALID.has(next)) return;
    setThemeState(next);
    setNeedsChoice(false);
    try { window.localStorage.setItem(STORAGE_KEY, next); } catch {}
    if (persistServer) {
      try { await api.setVenueTheme(next); }
      catch { /* non-fatal — localStorage is source of truth */ }
    }
  }, []);

  /**
   * Hydrate from server once venue data is available. Server wins over
   * localStorage if both differ, since the server copy follows the user
   * across devices.
   */
  const hydrateFromServer = useCallback((serverTheme) => {
    if (!VALID.has(serverTheme)) return;
    setThemeState(serverTheme);
    setNeedsChoice(false);
    try { window.localStorage.setItem(STORAGE_KEY, serverTheme); } catch {}
  }, []);

  return (
    <ThemeContext.Provider value={{ theme: theme || 'light', rawTheme: theme, needsChoice, setTheme, hydrateFromServer }}>
      {children}
    </ThemeContext.Provider>
  );
}
