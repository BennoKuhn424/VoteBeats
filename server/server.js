require('dotenv').config();
require('./instrument');

// Money-safety boot guard — refuse to start in production against an ephemeral
// disk (which would silently destroy all payment data on the next deploy).
// Runs before the DB module loads so a misconfigured deploy fails loudly at
// boot instead of quietly losing data later.
const { assertProductionDataSafety } = require('./utils/productionGuards');
assertProductionDataSafety();

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
// Two intervals, two responsibilities:
//   1. Fast tick (1s) — advance songs whose duration just elapsed. Only needs
//      to consider venues that currently have queue rows; SELECTing every
//      venue every second would waste CPU.
//   2. Slow tick (30s) — sweep EVERY venue and run autofillIfQueueEmpty so
//      a scheduled-playlist slot kicks in at its start time even when the
//      queue has been empty (no nowPlaying, no upcoming) for a while. Without
//      this sweep, an empty-queue venue falls off the fast tick (db.getQueues
//      returns no rows for it) and the schedule check never fires until
//      someone manually requests a song.
let shuttingDown = false;
const ADVANCE_TICK_MS = 1000;
const AUTOFILL_SWEEP_MS = 30_000;

const advanceInterval = setInterval(async () => {
  if (shuttingDown) return;
  // getQueues only returns venues with queue rows, so this ticks active queues
  // instead of every registered venue. Empty-queue venues are handled by the
  // slower sweep below.
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

// Slow sweep — picks up empty-queue venues so a scheduled playlist slot can
// start on time. Sweep logic lives in utils/autofillSweep.js so it's testable
// without booting the HTTP listener; this file just owns the interval timer.
const { runAutofillSweep } = require('./utils/autofillSweep');
const autofillSweepInterval = setInterval(() => {
  if (shuttingDown) return;
  runAutofillSweep({ db, autofillIfQueueEmpty: queueRouter.autofillIfQueueEmpty });
}, AUTOFILL_SWEEP_MS);

// Clear out abandoned checkouts — but verify with the provider first. A blind
// delete loses money when the patron paid and the webhook never arrived; see
// utils/pendingPaymentSweep.js for the full reasoning.
const { sweepStalePendingPayments } = require('./utils/pendingPaymentSweep');
const PENDING_PAYMENT_MAX_AGE_MS = 60 * 60 * 1000; // 1 hour
let pendingSweepRunning = false;
const pendingSweepInterval = setInterval(async () => {
  if (shuttingDown || pendingSweepRunning) return;
  pendingSweepRunning = true;
  try {
    await sweepStalePendingPayments({ maxAgeMs: PENDING_PAYMENT_MAX_AGE_MS });
  } catch (err) {
    console.warn('sweepStalePendingPayments:', err?.message);
  } finally {
    pendingSweepRunning = false;
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

// Nightly SQLite backup — in-process because Render web services have no
// cron. Runs scripts/backup-db.js on a timer; see utils/backupScheduler.js.
const { startBackupScheduler } = require('./utils/backupScheduler');
const backupScheduler = startBackupScheduler();

// Monthly payout generation. Without this, revenue for a month that nobody
// generated by hand never becomes a payout and is invisible everywhere.
const { startPayoutScheduler } = require('./utils/payoutScheduler');
const payoutScheduler = startPayoutScheduler();

// Crash-recovery: run the pending-payment sweep once shortly after boot. If a
// webhook was missed while the process was down (deploy, crash), the periodic
// 15-min sweep would otherwise leave that paid-but-unfulfilled checkout hanging
// until its next tick. This catches it right away. Delayed a little so the
// provider module and DB are fully warm first. (sweepStalePendingPayments is
// already required above for the periodic sweep.)
const startupSweepTimer = setTimeout(() => {
  if (shuttingDown) return;
  sweepStalePendingPayments({ maxAgeMs: PENDING_PAYMENT_MAX_AGE_MS }).catch((err) =>
    console.warn('startup pending sweep:', err?.message)
  );
}, 30 * 1000);

// Ledger self-check on boot (and daily) — verifies payouts never drift from the
// underlying payment rows. Surfaces silent corruption loudly instead of at
// dispute time. See utils/ledgerIntegrity.js.
const { checkLedgerIntegrity } = require('./utils/ledgerIntegrity');
const ledgerCheckTimer = setTimeout(() => {
  if (shuttingDown) return;
  try { checkLedgerIntegrity(); } catch (err) { console.warn('ledger integrity check:', err?.message); }
}, 60 * 1000);
const ledgerCheckInterval = setInterval(() => {
  if (shuttingDown) return;
  try { checkLedgerIntegrity(); } catch (err) { console.warn('ledger integrity check:', err?.message); }
}, 24 * 60 * 60 * 1000);

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
  clearInterval(autofillSweepInterval);
  clearInterval(pendingSweepInterval);
  clearInterval(ledgerCheckInterval);
  clearTimeout(startupSweepTimer);
  clearTimeout(ledgerCheckTimer);
  backupScheduler?.stop();
  payoutScheduler?.stop();
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
