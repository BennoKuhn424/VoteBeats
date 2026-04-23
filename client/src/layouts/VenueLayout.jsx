import { useEffect, useState } from 'react';
import { Outlet, useNavigate, useLocation, matchPath } from 'react-router-dom';
import { VenuePlaybackProvider } from '../context/VenuePlaybackContext';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import VenuePlayerBar from '../components/venue/VenuePlayerBar';
import ThemeChoiceModal from '../components/shared/ThemeChoiceModal';
import api from '../utils/api';

/**
 * Layout for venue dashboard, playlists, and related routes. Keeps
 * VenuePlaybackProvider mounted so playback continues across navigation, and
 * shows a persistent top player bar (Rockbot-style).
 */
export default function VenueLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, loading, setVenueCode } = useAuth();
  const { hydrateFromServer } = useTheme();
  const [verified, setVerified] = useState(false);

  const playerMatch = matchPath({ path: '/venue/player/:venueCode', end: true }, location.pathname);
  const codeFromPlayerUrl = playerMatch?.params?.venueCode;

  useEffect(() => {
    if (codeFromPlayerUrl) {
      setVenueCode(codeFromPlayerUrl);
    }
  }, [codeFromPlayerUrl, setVenueCode]);

  const venueCode = codeFromPlayerUrl || user?.venueCode || null;

  useEffect(() => {
    if (loading) return;
    if (!user) {
      navigate('/venue/login', { replace: true });
      return;
    }
    if (user.role === 'owner') {
      navigate('/owner', { replace: true });
      return;
    }
    if (!venueCode) {
      navigate('/venue/login', { replace: true });
      return;
    }
    // Validate the session is still active server-side on mount and
    // hydrate the theme from venue.settings.theme if the server has one.
    api.getVenue(venueCode).then((res) => {
      setVerified(true);
      const t = res.data?.settings?.theme;
      if (t === 'light' || t === 'dark') hydrateFromServer(t);
    }).catch(() => {
      // 401 interceptor in api.js will handle redirect + localStorage cleanup
    });
  }, [loading, user, venueCode, navigate, hydrateFromServer]);

  if (loading || !user || user.role === 'owner' || !venueCode) return null;

  return (
    <VenuePlaybackProvider venueCode={venueCode}>
      <div className="min-h-screen flex flex-col bg-zinc-50 dark:bg-dark-950 text-zinc-900 dark:text-zinc-100">
        <VenuePlayerBar venueCode={venueCode} />
        <div className="flex-1 min-h-0 overflow-auto">
          <Outlet />
        </div>
        <ThemeChoiceModal />
      </div>
    </VenuePlaybackProvider>
  );
}
