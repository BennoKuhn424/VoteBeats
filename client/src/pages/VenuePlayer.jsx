import { useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';

/**
 * Deep-link entry: /venue/player/:venueCode stores the code and sends the user
 * to the dashboard. Playback lives in the sticky VenuePlayerBar on all /venue routes.
 */
export default function VenuePlayer() {
  const { venueCode } = useParams();
  const navigate = useNavigate();

  useEffect(() => {
    if (venueCode) localStorage.setItem('speeldit_venue_code', venueCode);
    navigate('/venue/dashboard', { replace: true });
  }, [venueCode, navigate]);

  return null;
}
