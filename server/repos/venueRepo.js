/**
 * venueRepo — thin data-access layer for venue records.
 *
 * A plain wrapper for now; exists so all venue reads/writes flow through
 * one module and migration to a real DB is a single-file change.
 * Venue mutations are infrequent (settings saves, playlist edits) so
 * per-venue locking is not needed here.
 */

const db = require('../utils/database');

/** Read a single venue (returns undefined if not found). */
function get(venueCode) {
  return db.getVenue(venueCode);
}

/** Persist a venue record. */
function save(venueCode, venue) {
  db.saveVenue(venueCode, venue);
}

/** Read all venues as { [code]: venue }. */
function getAll() {
  return db.getAllVenues();
}

module.exports = { get, save, getAll };
