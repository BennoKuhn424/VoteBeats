/**
 * venueRepo — thin data-access layer for venue records.
 *
 * Includes a per-venue async mutex so concurrent playlist/settings
 * mutations are serialised (prevents 501-song playlists, lost writes).
 */

const db = require('../utils/database');

// ── Per-venue async mutex (same pattern as queueRepo) ────────────────────────
const lockChains = new Map();

async function withVenueLock(venueCode, fn) {
  const prev = lockChains.get(venueCode) ?? Promise.resolve();
  let releaseLock;
  const acquired = new Promise((r) => { releaseLock = r; });
  lockChains.set(venueCode, acquired);
  await prev;
  try {
    return await fn();
  } finally {
    releaseLock();
  }
}

/** Read a single venue (returns undefined if not found). */
function get(venueCode) {
  return db.getVenue(venueCode);
}

/** Persist a venue record. */
function save(venueCode, venue) {
  db.saveVenue(venueCode, venue);
}

/**
 * Locked read-modify-write for venue records.
 * mutateFn(venue) must return the modified venue or null for no-op.
 */
async function update(venueCode, mutateFn) {
  return withVenueLock(venueCode, () => {
    const current = db.getVenue(venueCode);
    if (!current) return current;
    const next = mutateFn(current);
    if (next == null) return current;
    db.saveVenue(venueCode, next);
    return next;
  });
}

/** Read all venues as { [code]: venue }. */
function getAll() {
  return db.getAllVenues();
}

module.exports = { get, save, getAll, update };
