import { useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

/**
 * Deep-link entry: /venue/player/:venueCode stores the code and sends the user
 * to the dashboard. Playback lives in the sticky VenuePlayerBar on all /venue routes.
 */
export default function VenuePlayer() {
  const { venueCode } = useParams();
  const navigate = useNavigate();
  const { setVenueCode } = useAuth();

  useEffect(() => {
    if (venueCode) setVenueCode(venueCode);
    navigate('/venue/dashboard', { replace: true });
  }, [venueCode, navigate, setVenueCode]);

  return null;
}
