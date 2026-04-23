import axios from 'axios';
import axiosRetry from 'axios-retry';

const API_URL = import.meta.env.VITE_API_URL || '/api';

// ngrok free tier: skip interstitial
const isNgrok = typeof window !== 'undefined' && /\.ngrok-free\.(app|dev)/.test(window.location.hostname);

const api = axios.create({
  baseURL: API_URL,
  // 10s timeout covers slow mobile networks; long ops (generatePlaylist) override per-call
  timeout: 10000,
  // Required so the browser sends the auth_token + csrf_token cookies cross-origin
  withCredentials: true,
  headers: {
    'Content-Type': 'application/json',
    ...(isNgrok && { 'ngrok-skip-browser-warning': '1' }),
  },
});

/** Reads the csrf_token cookie set by the server after login. */
function getCsrfToken() {
  if (typeof document === 'undefined') return '';
  const match = document.cookie.split(';').map((c) => c.trim()).find((c) => c.startsWith('csrf_token='));
  return match ? match.slice('csrf_token='.length) : '';
}

// Inject CSRF token on every state-changing request. Never send stale tokens on login/register.
api.interceptors.request.use((config) => {
  const method = (config.method || 'get').toLowerCase();
  const path = `${config.baseURL || ''}${config.url || ''}`;
  const isAuthPublic =
    path.includes('/auth/login') ||
    path.includes('/auth/register') ||
    (config.url || '').includes('auth/login') ||
    (config.url || '').includes('auth/register');

  if (!isAuthPublic && !['get', 'head', 'options'].includes(method)) {
    const csrf = getCsrfToken();
    if (csrf) config.headers['X-CSRF-Token'] = csrf;
  }
  return config;
});

// Expired or invalid session: clear local auth state and return to login.
// 402 with a subscription code → redirect the venue owner to /venue/billing.
api.interceptors.response.use(
  (res) => res,
  (error) => {
    const status = error.response?.status;
    const code = error.response?.data?.code;
    const u = String(error.config?.url || '');

    if (status === 402 && (code === 'SUBSCRIPTION_REQUIRED' || code === 'SUBSCRIPTION_INACTIVE')) {
      if (typeof window !== 'undefined' && !window.location.pathname.startsWith('/venue/billing')) {
        window.location.assign('/venue/billing');
      }
      return Promise.reject(error);
    }

    if (status !== 401) return Promise.reject(error);
    if (u.includes('auth/login') || u.includes('auth/register') || u.includes('auth/me')) {
      return Promise.reject(error);
    }
    // Clear client-side auth markers (the httpOnly cookie is cleared by /logout)
    localStorage.removeItem('speeldit_logged_in');
    localStorage.removeItem('speeldit_venue_code');
    localStorage.removeItem('speeldit_role');
    if (typeof window !== 'undefined' && !window.location.pathname.startsWith('/venue/login')) {
      window.location.assign('/venue/login');
    }
    return Promise.reject(error);
  },
);

// Retry on genuine network errors and 5xx — never on 4xx (user errors)
axiosRetry(api, {
  retries: 3,
  retryDelay: axiosRetry.exponentialDelay, // 1s → 2s → 4s
  shouldResetTimeout: true,               // reset the 10s timeout per attempt
  retryCondition: (error) => {
    // Network error (no response at all) OR server 5xx
    return axiosRetry.isNetworkError(error) || axiosRetry.isRetryableError(error);
  },
});

export default {
  getQueue: (venueCode, deviceId, config) =>
    api.get(`/queue/${venueCode}`, { params: deviceId ? { deviceId } : {}, ...config }),
  requestSong: (venueCode, song, deviceId) =>
    api.post(`/queue/${venueCode}/request`, { song, deviceId }),
  createPayment: (venueCode, song, deviceId) =>
    api.post(`/queue/${venueCode}/create-payment`, {
      song,
      deviceId,
      clientOrigin: typeof window !== 'undefined' ? window.location.origin : undefined,
    }),
  getRequestStatus: (venueCode, checkoutId) =>
    api.get(`/queue/${venueCode}/request-status`, { params: { checkoutId } }),
  vote: (venueCode, songId, voteValue, deviceId) =>
    api.post(`/queue/${venueCode}/vote`, { songId, voteValue, deviceId }),
  skipSong: (venueCode, songId) => api.post(`/queue/${venueCode}/skip`, { songId }),
  reportPlaying: (venueCode, songId, positionSeconds) =>
    api.post(`/queue/${venueCode}/playing`, { songId, positionSeconds: positionSeconds || 0 }),
  pausePlaying: (venueCode, songId) =>
    api.post(`/queue/${venueCode}/pause`, { songId }),
  advanceQueue: (venueCode, songId) => api.post(`/queue/${venueCode}/advance`, { songId }),
  reportPlayerVolume: (venueCode, volumePercent) =>
    api.post(`/queue/${venueCode}/report-volume`, { volumePercent }),
  submitVolumeFeedback: (venueCode, direction, deviceId) =>
    api.post(`/queue/${venueCode}/volume-feedback`, { direction, deviceId }),
  autofillQueue: (venueCode) => api.get(`/queue/${venueCode}/autofill`),
  removeSong: (venueCode, songId) => api.delete(`/queue/${venueCode}/song/${songId}`),

  search: (query, venueCode) =>
    api.get(`/search`, { params: { q: query, venueCode: venueCode || undefined } }),
  searchSongs: (query, venueCode) =>
    api.get(`/music/search`, { params: { q: query, venueCode } }),

  getLyrics: (title, artist, duration, config) =>
    api.get('/lyrics', { params: { title, artist, duration: duration || undefined }, ...config }),

  getDeveloperToken: () => api.get('/token'),

  getMe: () => api.get('/auth/me'),
  login: (email, password) => api.post('/auth/login', { email, password }),
  register: (email, password, venueName, location) =>
    api.post('/auth/register', { email, password, venueName, location }),
  logout: () => api.post('/auth/logout'),
  verifyEmail: (token) => api.get('/auth/verify-email', { params: { token } }),
  forgotPassword: (email) => api.post('/auth/forgot-password', { email }),
  resetPassword: (token, password) => api.post('/auth/reset-password', { token, password }),
  resendVerification: (email) => api.post('/auth/resend-verification', { email }),

  getVenue: (venueCode) => api.get(`/venue/${venueCode}`),

  createPlaylist: (venueCode, name) =>
    api.post(`/venue/${venueCode}/playlists`, { name }),
  deletePlaylist: (venueCode, playlistId) =>
    api.delete(`/venue/${venueCode}/playlists/${playlistId}`),
  activatePlaylist: (venueCode, playlistId) =>
    api.put(`/venue/${venueCode}/playlists/${playlistId}/activate`),
  renamePlaylist: (venueCode, playlistId, name) =>
    api.put(`/venue/${venueCode}/playlists/${playlistId}/rename`, { name }),
  addToPlaylist: (venueCode, playlistId, song) =>
    api.post(`/venue/${venueCode}/playlists/${playlistId}/songs`, song),
  removeFromPlaylist: (venueCode, playlistId, appleId) =>
    api.delete(`/venue/${venueCode}/playlists/${playlistId}/songs/${appleId}`),
  generatePlaylistCheckout: (venueCode, playlistId, prompt, count) =>
    api.post(`/venue/${venueCode}/playlists/${playlistId}/generate-checkout`, { prompt, count }),
  generatePlaylist: (venueCode, playlistId, checkoutId, prompt, count) =>
    // AI generation can take 30s — override timeout for this call only
    api.post(`/venue/${venueCode}/playlists/${playlistId}/generate`, { checkoutId, prompt, count }, { timeout: 60000 }),
  updateSettings: (venueCode, settings) =>
    api.put(`/venue/${venueCode}/settings`, settings),
  setVenueTheme: (theme) => {
    // Read venue code lazily so this works even before full auth hydration.
    const code = (typeof localStorage !== 'undefined' && localStorage.getItem('speeldit_venue_code')) || '';
    if (!code) return Promise.reject(new Error('No venue code for theme write'));
    return api.put(`/venue/${code}/theme`, { theme });
  },
  banArtist: (venueCode, artist) =>
    api.post(`/venue/${venueCode}/ban-artist`, { artist }),
  getVenueEarnings: (venueCode, year, month) =>
    api.get(`/venue/${venueCode}/earnings`, { params: { year, month } }),
  getAnalytics: (venueCode, days) =>
    api.get(`/venue/${venueCode}/analytics`, { params: { days } }),

  getOwnerOverview: () => api.get('/owner/overview'),

  // Payouts — venue side
  getVenueBankDetails: (venueCode) =>
    api.get(`/payouts/venue/${venueCode}/bank-details`),
  updateVenueBankDetails: (venueCode, bankDetails) =>
    api.put(`/payouts/venue/${venueCode}/bank-details`, bankDetails),
  getVenuePayouts: (venueCode) =>
    api.get(`/payouts/venue/${venueCode}`),

  // Payouts — owner side
  generatePayouts: (year, month) =>
    api.post('/payouts/generate', { year, month }),
  listPayouts: (params) => api.get('/payouts', { params }),
  updatePayoutStatus: (id, status, notes) =>
    api.put(`/payouts/${id}/status`, { status, notes }),
  markAllPayoutsPaid: (year, month) =>
    api.post('/payouts/mark-all-paid', { year, month }),
  getPayoutSummary: () => api.get('/payouts/summary'),

  // Subscriptions (Paystack)
  getSubscription: () => api.get('/subscriptions/me'),
  startSubscription: () => api.post('/subscriptions/start'),
  completeSubscription: (reference) => api.post('/subscriptions/complete', { reference }),
  getSubscriptionManageLink: () => api.post('/subscriptions/manage-link'),
  cancelSubscription: () => api.post('/subscriptions/cancel'),
};
