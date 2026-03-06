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

  // If no venue code and we're on a route that needs it, redirect to login
  const token = localStorage.getItem('speeldit_token');
  if (!token) {
    navigate('/venue/login');
    return null;
  }
  if (!venueCode && !paramVenueCode) {
    // On dashboard without venueCode in URL - we have it from localStorage
    // venueCode from above handles that
  }

  return (
    <VenuePlaybackProvider venueCode={venueCode}>
      <Outlet />
    </VenuePlaybackProvider>
  );
}
