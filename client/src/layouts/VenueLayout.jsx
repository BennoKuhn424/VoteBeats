import { useEffect } from 'react';
import { Outlet, useParams, useNavigate } from 'react-router-dom';
import { VenuePlaybackProvider } from '../context/VenuePlaybackContext';

/**
 * Layout for venue dashboard and player. Keeps VenuePlaybackProvider mounted
 * so music continues playing and queue keeps advancing when navigating between pages.
 */
export default function VenueLayout() {
  const { venueCode: paramVenueCode } = useParams();
  const navigate = useNavigate();
  const venueCode = paramVenueCode || localStorage.getItem('speeldit_venue_code') || null;
  const token = localStorage.getItem('speeldit_token');

  // Move redirect into an effect so it never fires during render (React 18 safe)
  useEffect(() => {
    if (!token) navigate('/venue/login');
  }, [token, navigate]);

  if (!token) return null;

  return (
    <VenuePlaybackProvider venueCode={venueCode}>
      <Outlet />
    </VenuePlaybackProvider>
  );
}
