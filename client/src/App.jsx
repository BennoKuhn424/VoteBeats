import { useEffect, lazy, Suspense } from 'react';
import { Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom';
import CookieConsent from './components/shared/CookieConsent';

// Route-level code splitting: each page is its own chunk, fetched on demand.
// This keeps the initial download small — a patron hitting /v/:code never
// pays for the venue dashboard, billing, owner, or auth bundles. The Suspense
// fallback below covers the brief fetch of the matched chunk.
const Home = lazy(() => import('./pages/Home'));
const CustomerVoting = lazy(() => import('./pages/CustomerVoting'));
const RequestSuccess = lazy(() => import('./pages/RequestSuccess'));
const VenueLogin = lazy(() => import('./pages/VenueLogin'));
const VenueLayout = lazy(() => import('./layouts/VenueLayout'));
const VenueDashboard = lazy(() => import('./pages/VenueDashboard'));
const VenuePlayer = lazy(() => import('./pages/VenuePlayer'));
const VenueBrowsePlaylists = lazy(() => import('./pages/VenueBrowsePlaylists'));
const VenueBilling = lazy(() => import('./pages/VenueBilling'));
const VenueBillingComplete = lazy(() => import('./pages/VenueBillingComplete'));
const OwnerDashboard = lazy(() => import('./pages/OwnerDashboard'));
const VerifyEmail = lazy(() => import('./pages/VerifyEmail'));
const ForgotPassword = lazy(() => import('./pages/ForgotPassword'));
const ResetPassword = lazy(() => import('./pages/ResetPassword'));
const PrivacyPolicy = lazy(() => import('./pages/PrivacyPolicy'));
const TermsOfService = lazy(() => import('./pages/TermsOfService'));

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

/**
 * Minimal, theme-agnostic fallback shown while a route chunk loads. Marked
 * role=status so assistive tech announces the brief loading state. Honours
 * reduced-motion via the global net (the spin collapses to static).
 */
function RouteFallback() {
  return (
    <div
      role="status"
      className="min-h-screen flex items-center justify-center bg-carbon-50 dark:bg-dark-950"
    >
      <div className="w-9 h-9 border-2 border-amethyst-400 border-t-transparent rounded-full animate-spin" />
      <span className="sr-only">Loading…</span>
    </div>
  );
}

export default function App() {
  return (
    <>
      <AuthRecovery />
      <Suspense fallback={<RouteFallback />}>
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
            <Route path="billing" element={<VenueBilling />} />
            <Route path="billing/complete" element={<VenueBillingComplete />} />
            <Route path="player/:venueCode" element={<VenuePlayer />} />
          </Route>
        </Routes>
      </Suspense>
      <CookieConsent />
    </>
  );
}
