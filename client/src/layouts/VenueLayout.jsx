import { useEffect, useState } from 'react';
import { Outlet, useNavigate, useLocation, matchPath } from 'react-router-dom';
import { VenuePlaybackProvider } from '../context/VenuePlaybackContext';
import { useAuth } from '../context/AuthContext';
import VenuePlayerBar from '../components/venue/VenuePlayerBar';
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
    // Validate the session is still active server-side on mount
    api.getVenue(venueCode).then(() => setVerified(true)).catch(() => {
      // 401 interceptor in api.js will handle redirect + localStorage cleanup
    });
  }, [loading, user, venueCode, navigate]);

  if (loading || !user || user.role === 'owner' || !venueCode) return null;

  return (
    <VenuePlaybackProvider venueCode={venueCode}>
      <div className="min-h-screen flex flex-col bg-zinc-50">
        <VenuePlayerBar venueCode={venueCode} />
        <div className="flex-1 min-h-0 overflow-auto">
          <Outlet />
        </div>
      </div>
    </VenuePlaybackProvider>
  );
}
