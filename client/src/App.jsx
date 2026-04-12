import { useEffect } from 'react';
import { Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom';
import Home from './pages/Home';
import CustomerVoting from './pages/CustomerVoting';
import RequestSuccess from './pages/RequestSuccess';
import VenueLogin from './pages/VenueLogin';
import VenueLayout from './layouts/VenueLayout';
import VenueDashboard from './pages/VenueDashboard';
import VenuePlayer from './pages/VenuePlayer';
import VenueBrowsePlaylists from './pages/VenueBrowsePlaylists';
import OwnerDashboard from './pages/OwnerDashboard';
import VerifyEmail from './pages/VerifyEmail';
import ForgotPassword from './pages/ForgotPassword';
import ResetPassword from './pages/ResetPassword';
import PrivacyPolicy from './pages/PrivacyPolicy';
import TermsOfService from './pages/TermsOfService';
import CookieConsent from './components/shared/CookieConsent';

/**
 * On mobile Safari the Apple Music authorize() flow can redirect the user
 * away from the venue page. When they return to the app we check
 * sessionStorage for a pending auth and navigate them back automatically.
 */
function AuthRecovery() {
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem('speeldit_auth_pending');
      if (!raw) return;
      const pending = JSON.parse(raw);
      // Only recover if less than 10 minutes old and we're NOT already on the
      // correct venue page (avoid infinite loop).
      const AGE_LIMIT = 10 * 60 * 1000;
      if (Date.now() - pending.ts > AGE_LIMIT) {
        sessionStorage.removeItem('speeldit_auth_pending');
        return;
      }
      if (pending.returnPath && pending.returnPath !== location.pathname) {
        sessionStorage.removeItem('speeldit_auth_pending');
        navigate(pending.returnPath, { replace: true });
      }
    } catch {
      sessionStorage.removeItem('speeldit_auth_pending');
    }
  }, [navigate, location.pathname]);

  return null;
}

export default function App() {
  return (
    <>
      <AuthRecovery />
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/privacy" element={<PrivacyPolicy />} />
        <Route path="/terms" element={<TermsOfService />} />
        <Route path="/owner" element={<OwnerDashboard />} />
        <Route path="/v/:venueCode" element={<CustomerVoting />} />
        <Route path="/v/:venueCode/request-success" element={<RequestSuccess />} />
        <Route path="/verify-email" element={<VerifyEmail />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/reset-password" element={<ResetPassword />} />
        <Route path="/venue/login" element={<VenueLogin />} />
        <Route path="/venue" element={<VenueLayout />}>
          <Route index element={<Navigate to="/venue/dashboard" replace />} />
          <Route path="dashboard" element={<VenueDashboard />} />
          <Route path="playlists" element={<VenueBrowsePlaylists />} />
          <Route path="player/:venueCode" element={<VenuePlayer />} />
        </Route>
      </Routes>
      <CookieConsent />
    </>
  );
}
