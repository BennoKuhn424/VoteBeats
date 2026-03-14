import { io } from 'socket.io-client';

// Strip /api suffix so we connect to the socket server root
const SERVER_URL = (import.meta.env.VITE_API_URL || '')
  .replace(/\/api\/?$/, '')
  .replace(/\/$/, '') || '';

const socket = io(SERVER_URL, {
  autoConnect: false,
  reconnection: true,
  reconnectionAttempts: Infinity,   // keep trying forever
  reconnectionDelay: 1000,
  reconnectionDelayMax: 10000,      // cap backoff at 10s
  randomizationFactor: 0.5,         // jitter prevents thundering herd in crowded venues
  transports: ['websocket', 'polling'], // WebSocket first; fall back to long-polling
});

// ── iOS Safari: reconnect immediately when user returns to the tab ───────────
// iOS suspends WebSocket connections when the screen locks or the user
// switches apps. The socket dies silently. We force a fresh connect when
// the tab becomes visible again. The 100ms delay avoids the iOS 18 Safari
// bug where fetch/socket setup fails if called synchronously in this handler.
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      setTimeout(() => {
        if (!socket.connected) socket.connect();
      }, 100);
    }
  });

  // Network restored (WiFi → cellular switch, etc.) — reconnect immediately
  window.addEventListener('online', () => {
    if (!socket.connected) socket.connect();
  });
}

export default socket;
