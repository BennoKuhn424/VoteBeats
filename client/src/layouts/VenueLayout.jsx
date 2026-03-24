import { useEffect } from 'react';
import { Outlet, useNavigate, useLocation, matchPath } from 'react-router-dom';
import { VenuePlaybackProvider } from '../context/VenuePlaybackContext';
import VenuePlayerBar from '../components/venue/VenuePlayerBar';

/**
 * Layout for venue dashboard, playlists, and related routes. Keeps
 * VenuePlaybackProvider mounted so playback continues across navigation, and
 * shows a persistent top player bar (Rockbot-style).
 */
export default function VenueLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const token = localStorage.getItem('speeldit_token');

  const playerMatch = matchPath({ path: '/venue/player/:venueCode', end: true }, location.pathname);
  const codeFromPlayerUrl = playerMatch?.params?.venueCode;

  useEffect(() => {
    if (codeFromPlayerUrl) {
      localStorage.setItem('speeldit_venue_code', codeFromPlayerUrl);
    }
  }, [codeFromPlayerUrl]);

  const venueCode = codeFromPlayerUrl || localStorage.getItem('speeldit_venue_code') || null;

  useEffect(() => {
    if (!token) {
      navigate('/venue/login');
      return;
    }
    if (!venueCode) {
      navigate('/venue/login', { replace: true });
    }
  }, [token, venueCode, navigate]);

  if (!token) return null;
  if (!venueCode) return null;

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
