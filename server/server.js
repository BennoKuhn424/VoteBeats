require('dotenv').config();
const http = require('http');
const express = require('express');
const cors = require('cors');
const { Server } = require('socket.io');
const { advanceToNextSong } = require('./utils/queueAdvance');
const broadcast = require('./utils/broadcast');
const db = require('./utils/database');
const { yocoWebhook } = require('./routes/webhooks');

const app = express();
const httpServer = http.createServer(app);

// ── Socket.IO ────────────────────────────────────────────────────────────────
const io = new Server(httpServer, {
  cors: { origin: '*' },
  // Server pings every 25s (Socket.IO v4 default).
  // pingTimeout bumped to 30s so iOS Safari has enough time to wake up
  // and respond before the server declares the connection dead.
  // Total tolerance = 25 + 30 = 55s — covers screen-lock + app-switch scenarios.
  pingInterval: 25000,
  pingTimeout: 30000,
  // Keep polling as fallback transport for restrictive corporate/venue WiFi
  // that blocks WebSocket upgrades.
  transports: ['websocket', 'polling'],
});

broadcast.init(io);

io.on('connection', (socket) => {
  socket.on('join', (venueCode) => {
    if (typeof venueCode === 'string' && venueCode) {
      socket.join(`venue:${venueCode}`);
    }
  });
});

// ── Express middleware ────────────────────────────────────────────────────────
app.use(cors());

// Yoco webhook needs raw body for signature verification (must be before express.json)
app.post('/api/webhooks/yoco', express.raw({ type: 'application/json' }), yocoWebhook);

app.use(express.json());

app.use('/api/auth', require('./routes/auth'));
app.use('/api/token', require('./routes/token'));
app.use('/api/queue', require('./routes/queue'));
app.use('/api/search', require('./routes/search'));
app.use('/api/lyrics', require('./routes/lyrics'));
app.use('/api/music', require('./routes/music'));
app.use('/api/venue', require('./routes/venue'));
app.use('/api/admin', require('./routes/admin'));

// ── Auto-advance interval ─────────────────────────────────────────────────────
// Computes current position using the anchor pattern (Spotify-style):
//   currentPositionMs = positionMs + (Date.now() - positionAnchoredAt)
// Falls back to legacy startedAt field for songs set before this update.
setInterval(() => {
  const queues = db.getQueues();
  Object.entries(queues).forEach(([venueCode, queue]) => {
    const np = queue.nowPlaying;
    const upcoming = queue.upcoming || [];

    if (np) {
      // Skip advance while paused
      if (np.isPaused || np.pausedAt) return;

      let durationMs = (np.duration || 180) * 1000;
      if (durationMs < 60000) durationMs = 180000;

      // Anchor pattern position
      const posMs = np.positionMs ?? 0;
      const anchoredAt = np.positionAnchoredAt ?? np.startedAt ?? Date.now();
      const currentPos = posMs + (Date.now() - anchoredAt);

      if (currentPos >= durationMs) {
        advanceToNextSong(venueCode);
        const updated = db.getQueue(venueCode);
        broadcast.broadcastQueue(venueCode, updated);
      }
    } else if (upcoming.length > 0) {
      // Auto-start first song when nothing is playing
      advanceToNextSong(venueCode);
      const updated = db.getQueue(venueCode);
      broadcast.broadcastQueue(venueCode, updated);
    }
  });
}, 5000);

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => console.log(`Speeldit server running on port ${PORT}`));
