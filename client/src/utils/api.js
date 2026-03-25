import axios from 'axios';
import axiosRetry from 'axios-retry';

const API_URL = import.meta.env.VITE_API_URL || '/api';

// ngrok free tier: skip interstitial
const isNgrok = typeof window !== 'undefined' && /\.ngrok-free\.(app|dev)/.test(window.location.hostname);

const api = axios.create({
  baseURL: API_URL,
  // 10s timeout covers slow mobile networks; long ops (generatePlaylist) override per-call
  timeout: 10000,
  headers: {
    'Content-Type': 'application/json',
    ...(isNgrok && { 'ngrok-skip-browser-warning': '1' }),
  },
});

// JWT injection — never send an old session token on login/register (confuses auth + 401 handling)
api.interceptors.request.use((config) => {
  const path = `${config.baseURL || ''}${config.url || ''}`;
  const isAuthPublic =
    path.includes('/auth/login') ||
    path.includes('/auth/register') ||
    (config.url || '').includes('auth/login') ||
    (config.url || '').includes('auth/register');
  if (!isAuthPublic) {
    const token = localStorage.getItem('speeldit_token');
    if (token) config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Expired or invalid venue session: clear storage and return to login (skip auth form errors)
api.interceptors.response.use(
  (res) => res,
  (error) => {
    if (error.response?.status !== 401) return Promise.reject(error);
    const u = String(error.config?.url || '');
    if (u.includes('auth/login') || u.includes('auth/register')) {
      return Promise.reject(error);
    }
    if (!localStorage.getItem('speeldit_token')) return Promise.reject(error);
    localStorage.removeItem('speeldit_token');
    localStorage.removeItem('speeldit_venue_code');
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

  getLyrics: (title, artist, duration) =>
    api.get('/lyrics', { params: { title, artist, duration: duration || undefined } }),

  getDeveloperToken: () => api.get('/token'),

  login: (email, password) => api.post('/auth/login', { email, password }),
  register: (email, password, venueName, location) =>
    api.post('/auth/register', { email, password, venueName, location }),

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
  banArtist: (venueCode, artist) =>
    api.post(`/venue/${venueCode}/ban-artist`, { artist }),
  getVenueEarnings: (venueCode, year, month) =>
    api.get(`/venue/${venueCode}/earnings`, { params: { year, month } }),
  getAnalytics: (venueCode, days) =>
    api.get(`/venue/${venueCode}/analytics`, { params: { days } }),
};
