require('dotenv').config();
require('./instrument');
const http = require('http');
const { Server } = require('socket.io');
const { advanceToNextSong } = require('./utils/queueAdvance');
const broadcast = require('./utils/broadcast');
const db = require('./utils/database');
const { app, queueRouter, allowedOrigins } = require('./app');

const httpServer = http.createServer(app);

// ── Socket.IO (reuses the same CORS allowlist built in app.js) ───────────────
const io = new Server(httpServer, {
  cors: { origin: allowedOrigins, credentials: true },
  pingInterval: 25000,
  pingTimeout: 30000,
  transports: ['websocket', 'polling'],
});

broadcast.init(io);

io.on('connection', (socket) => {
  socket.on('join', (venueCode) => {
    // Validate: must be a non-empty string, max 20 chars (venue codes are 6 chars)
    if (typeof venueCode === 'string' && venueCode.trim() && venueCode.length <= 20) {
      socket.join(`venue:${venueCode.trim()}`);
    }
  });
});

// ── Auto-advance interval ─────────────────────────────────────────────────────
let shuttingDown = false;
const ADVANCE_TICK_MS = 1000;
const advanceInterval = setInterval(async () => {
  if (shuttingDown) return;
  // getQueues only returns venues with queue rows, so this ticks active queues
  // instead of every registered venue.
  const queues = db.getQueues();
  for (const [venueCode, queue] of Object.entries(queues)) {
    try {
      const np = queue.nowPlaying;
      const upcoming = queue.upcoming || [];

      if (np) {
        if (np.isPaused || np.pausedAt) continue;

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
    } catch (err) {
      console.error(`[advance] venue ${venueCode}:`, err?.message || err);
    }
  }
}, ADVANCE_TICK_MS);

// Drop abandoned Yoco checkouts so pendingPayments.json cannot grow forever
const PENDING_PAYMENT_MAX_AGE_MS = 60 * 60 * 1000; // 1 hour
setInterval(() => {
  try {
    const n = db.purgeStalePendingPayments(PENDING_PAYMENT_MAX_AGE_MS);
    if (n > 0) {
      console.log(JSON.stringify({
        t: new Date().toISOString(),
        msg: 'pending-payments-purged',
        count: n,
      }));
    }
  } catch (err) {
    console.warn('purgeStalePendingPayments:', err?.message);
  }
}, 15 * 60 * 1000);

const THROTTLE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
setInterval(() => {
  try {
    db.purgeThrottles?.(THROTTLE_MAX_AGE_MS);
  } catch (err) {
    console.warn('purgeThrottles:', err?.message);
  }
}, 60 * 60 * 1000);

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
  console.log(JSON.stringify({
    t: new Date().toISOString(),
    msg: 'speeldit-server-listen',
    port: PORT,
  }));
});

// ── Graceful shutdown (SIGTERM from PaaS, SIGINT from Ctrl-C) ────────────────
const SHUTDOWN_TIMEOUT_MS = 12_000;

function gracefulShutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  clearInterval(advanceInterval);
  console.log(JSON.stringify({
    t: new Date().toISOString(),
    msg: 'speeldit-server-shutdown',
    signal,
  }));

  // Force exit if clean shutdown stalls (e.g. stuck connections)
  const forceTimer = setTimeout(() => {
    console.error('Shutdown timed out — forcing exit');
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);
  forceTimer.unref(); // don't let the timer itself keep the process alive

  // 1. Stop accepting new HTTP connections
  httpServer.close(() => {
    // 2. Disconnect all Socket.IO clients
    io.close(() => {
      process.exit(0);
    });
  });
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
