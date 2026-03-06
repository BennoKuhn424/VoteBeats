import axios from 'axios';

const API_URL = import.meta.env.VITE_API_URL || '/api';

// ngrok free tier: add header to skip interstitial (fixes 503 on API calls)
const isNgrok = typeof window !== 'undefined' && /\.ngrok-free\.(app|dev)/.test(window.location.hostname);

const api = axios.create({
  baseURL: API_URL,
  headers: {
    'Content-Type': 'application/json',
    ...(isNgrok && { 'ngrok-skip-browser-warning': '1' }),
  },
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('speeldit_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

export default {
  getQueue: (venueCode, deviceId) =>
    api.get(`/queue/${venueCode}`, { params: deviceId ? { deviceId } : {} }),
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
  skipSong: (venueCode) => api.post(`/queue/${venueCode}/skip`),
  reportPlaying: (venueCode, songId) =>
    api.post(`/queue/${venueCode}/playing`, { songId }),
  advanceQueue: (venueCode) => api.post(`/queue/${venueCode}/advance`),
  autofillQueue: (venueCode) => api.get(`/queue/${venueCode}/autofill`),
  removeSong: (venueCode, songId) => api.delete(`/queue/${venueCode}/song/${songId}`),

  searchSongs: (query, venueCode) =>
    api.get(`/music/search`, { params: { q: query, venueCode } }),

  // New Apple Music search (returns trackName, artistName, artwork, songId)
  search: (query, venueCode) =>
    api.get(`/search`, { params: { q: query, venueCode: venueCode || undefined } }),

  getLyrics: (title, artist, duration) =>
    api.get('/lyrics', { params: { title, artist, duration: duration || undefined } }),

  getDeveloperToken: () => api.get('/token'),

  login: (email, password) => api.post('/auth/login', { email, password }),
  register: (email, password, venueName, location) =>
    api.post('/auth/register', { email, password, venueName, location }),

  getVenue: (venueCode) => api.get(`/venue/${venueCode}`),

  // Multi-playlist management
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
    api.post(`/venue/${venueCode}/playlists/${playlistId}/generate`, { checkoutId, prompt, count }),
  updateSettings: (venueCode, settings) =>
    api.put(`/venue/${venueCode}/settings`, settings),
  getVenueEarnings: (venueCode, year, month) =>
    api.get(`/venue/${venueCode}/earnings`, { params: { year, month } }),
};
