require('dotenv').config();
const http = require('http');
const { Server } = require('socket.io');
const { advanceToNextSong } = require('./utils/queueAdvance');
const broadcast = require('./utils/broadcast');
const db = require('./utils/database');
const { app, queueRouter } = require('./app');

const httpServer = http.createServer(app);

// ── Socket.IO ────────────────────────────────────────────────────────────────
const io = new Server(httpServer, {
  cors: { origin: '*' },
  pingInterval: 25000,
  pingTimeout: 30000,
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

// ── Auto-advance interval ─────────────────────────────────────────────────────
setInterval(() => {
  const queues = db.getQueues();
  Object.entries(queues).forEach(async ([venueCode, queue]) => {
    const np = queue.nowPlaying;
    const upcoming = queue.upcoming || [];

    if (np) {
      if (np.isPaused || np.pausedAt) return;

      let durationMs = (np.duration || 0) * 1000;
      if (durationMs < 30000) durationMs = 600000;

      const posMs = np.positionMs ?? 0;
      const anchoredAt = np.positionAnchoredAt ?? np.startedAt ?? Date.now();
      const currentPos = posMs + (Date.now() - anchoredAt);

      if (currentPos >= durationMs + 10000) {
        const updated = await advanceToNextSong(venueCode, np.id);
        broadcast.broadcastQueue(venueCode, updated);
      }
    } else if (upcoming.length > 0) {
      const updated = await advanceToNextSong(venueCode);
      broadcast.broadcastQueue(venueCode, updated);
    } else {
      await queueRouter.autofillIfQueueEmpty?.(venueCode);
    }
  });
}, 5000);

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
  console.log(JSON.stringify({
    t: new Date().toISOString(),
    msg: 'speeldit-server-listen',
    port: PORT,
  }));
});
