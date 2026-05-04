/**
 * queueRepo — thin data-access layer for queue state.
 *
 * All queue mutations go through `update()`, which:
 *   1. Acquires a per-venue async mutex  → no concurrent lost-updates
 *   2. Reads the latest queue inside the lock
 *   3. Calls the caller's mutateFn (must be synchronous)
 *   4. Runs validateQueue before writing
 *
 * Centralising these three concerns here means:
 *   - No route handler needs to call validateQueue manually.
 *   - Per-venue locking can be added/tuned in one place.
 *   - Swapping the underlying store (JSON → SQLite/Postgres) is a
 *     single-file change.
 *
 * The per-venue mutex is an in-memory promise chain.  It serialises
 * concurrent mutations to the same venue without blocking the event
 * loop and without external dependencies.  A single Node.js process is
 * assumed (horizontal scaling would need Redis/DB-level locks).
 */

const db = require('../utils/database');
const sqlite = require('../utils/sqlite');
const { validateQueue } = require('../utils/validateQueue');

// ── Per-venue async mutex ─────────────────────────────────────────────────────
// Maps venueCode → the Promise of the most-recently-started operation.
// Each new caller appends to the chain; only one mutateFn runs at a time.
const lockChains = new Map();

async function withVenueLock(venueCode, fn) {
  const prev = lockChains.get(venueCode) ?? Promise.resolve();
  let releaseLock;
  // `acquired` is what the NEXT caller will await.
  const acquired = new Promise((r) => { releaseLock = r; });
  lockChains.set(venueCode, acquired);
  await prev; // wait for whoever went before us
  try {
    return await fn();
  } finally {
    releaseLock(); // unblock the next caller
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Read the current queue — no lock.
 * Safe for GET handlers and checks that don't modify state.
 */
function get(venueCode) {
  return db.getQueue(venueCode);
}

/**
 * Locked read-modify-write.
 *
 * mutateFn(currentQueue) must be **synchronous** and return either:
 *   - the new queue object  → validateQueue runs, then the queue is written
 *   - null / undefined      → no-op, the current queue is returned unchanged
 *
 * The mutateFn body, the queue write, and any DB side-effects the mutateFn
 * triggers (vote writes, analytics inserts, etc.) all run inside a SINGLE
 * SQLite transaction. If anything throws, the whole thing rolls back — votes
 * never get out of sync with the queue, analytics never get logged for an
 * action that didn't happen, and so on. better-sqlite3's transactions are
 * SAVEPOINT-based and nest correctly with inner db.transaction() calls.
 *
 * Returns a Promise that resolves to the queue after the operation:
 *   - the new queue if a write happened
 *   - the unchanged current queue if mutateFn returned null
 *
 * @param {string}   venueCode
 * @param {Function} mutateFn  (currentQueue) => newQueue | null
 * @returns {Promise<object>}
 */
async function update(venueCode, mutateFn) {
  return withVenueLock(venueCode, () => {
    const current = db.getQueue(venueCode);

    // Wrap the mutateFn + queue write in one SQLite transaction so all DB
    // side-effects (votes, analytics) are atomic with the queue write.
    let next;
    sqlite.transaction(() => {
      next = mutateFn(current);
      if (next == null) return; // no-op — caller signalled skip
      validateQueue(venueCode, next);
      db.updateQueue(venueCode, next);
    })();

    return next == null ? current : next;
  });
}

module.exports = { get, update, withVenueLock };
