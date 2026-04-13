import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import api from '../utils/api';

const AuthContext = createContext(null);

export function useAuth() {
  return useContext(AuthContext);
}

/**
 * Central auth state derived from the httpOnly cookie via GET /api/auth/me.
 * Replaces all scattered localStorage checks for speeldit_logged_in,
 * speeldit_venue_code, and speeldit_role.
 *
 * States:
 *   loading=true   → initial check in progress (show nothing / spinner)
 *   user=null      → not authenticated
 *   user.role='venue' → venue owner, user.venueCode is set
 *   user.role='owner' → platform owner
 */
export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  // Check the session cookie on mount
  useEffect(() => {
    api.getMe()
      .then((res) => {
        setUser(res.data);
        // Keep localStorage in sync for the few places that still read it
        // (e.g. VenuePlaybackContext init guard, api.js 401 interceptor).
        localStorage.setItem('speeldit_logged_in', '1');
        if (res.data.role === 'owner') {
          localStorage.setItem('speeldit_role', 'owner');
          localStorage.removeItem('speeldit_venue_code');
        } else {
          localStorage.removeItem('speeldit_role');
          if (res.data.venueCode) {
            localStorage.setItem('speeldit_venue_code', res.data.venueCode);
          }
        }
      })
      .catch(() => {
        setUser(null);
        localStorage.removeItem('speeldit_logged_in');
        localStorage.removeItem('speeldit_venue_code');
        localStorage.removeItem('speeldit_role');
      })
      .finally(() => setLoading(false));
  }, []);

  /** Called after a successful login response. */
  const login = useCallback((data) => {
    if (data.role === 'owner') {
      setUser({ role: 'owner' });
      localStorage.setItem('speeldit_logged_in', '1');
      localStorage.setItem('speeldit_role', 'owner');
      localStorage.removeItem('speeldit_venue_code');
    } else {
      const venueCode = data.venue?.code ?? data.venueCode;
      setUser({ role: 'venue', venueCode, venueName: data.venue?.name });
      localStorage.setItem('speeldit_logged_in', '1');
      localStorage.removeItem('speeldit_role');
      localStorage.setItem('speeldit_venue_code', venueCode);
    }
  }, []);

  /** Called on logout — clears everything. */
  const logout = useCallback(async () => {
    try { await api.logout(); } catch {}
    setUser(null);
    localStorage.removeItem('speeldit_logged_in');
    localStorage.removeItem('speeldit_venue_code');
    localStorage.removeItem('speeldit_role');
  }, []);

  /** Update the venueCode (e.g. when navigating to /venue/player/:code). */
  const setVenueCode = useCallback((code) => {
    setUser((prev) => prev ? { ...prev, venueCode: code } : prev);
    localStorage.setItem('speeldit_venue_code', code);
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, setVenueCode }}>
      {children}
    </AuthContext.Provider>
  );
}
