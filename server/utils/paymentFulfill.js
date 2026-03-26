const { v4: uuidv4 } = require('uuid');
const db = require('./database');
const queueRepo = require('../repos/queueRepo');

/**
 * In-flight guard: prevents the webhook and polling paths from fulfilling the
 * same checkoutId concurrently (the DB remove is not atomic with the queue write).
 */
const inFlightCheckouts = new Set();

/**
 * Fulfill a paid song request: add song to queue, log payment, remove pending.
 *
 * Idempotency strategy:
 *  1. In-flight Set prevents two concurrent calls for the same checkoutId.
 *  2. `removePendingPayment` runs BEFORE the queue write so a crash after
 *     removal but before the write loses the song (safe) rather than adding
 *     it twice (unsafe — user charged once, song appears twice).
 *  3. If the queue write fails, the payment is still logged (user was charged)
 *     and an error is thrown so the caller can log it.
 */
async function fulfillPaidRequest(checkoutId, amountCentsOverride) {
  // ── Idempotent: already fulfilled or no record ──
  const pending = db.getPendingPayment(checkoutId);
  if (!pending) return false;

  // ── Concurrent-call guard ──
  if (inFlightCheckouts.has(checkoutId)) return false;
  inFlightCheckouts.add(checkoutId);

  try {
    const { venueCode, song: songData, deviceId, amountCents } = pending;
    const venue = db.getVenue(venueCode);
    if (!venue) {
      db.removePendingPayment(checkoutId);
      return false;
    }

    // ── Remove pending FIRST (crash-safe: lose the song, not double-add) ──
    db.removePendingPayment(checkoutId);

    const song = {
      ...songData,
      id: songData.id || `song_${uuidv4()}`,
      votes: 0,
      requestedBy: deviceId,
      requestedAt: Date.now(),
    };

    await queueRepo.update(venueCode, (queue) => {
      if (!queue.nowPlaying) {
        return {
          nowPlaying: { ...song, positionMs: 0, positionAnchoredAt: Date.now(), isPaused: false },
          upcoming: queue.upcoming || [],
        };
      }
      return { nowPlaying: queue.nowPlaying, upcoming: [...(queue.upcoming || []), song] };
    });

    // Same analytics as POST /request (paid flow bypasses that route)
    db.recordAnalyticsEvent(venueCode, {
      type: 'request',
      songTitle: song.title || 'Unknown',
      artist: song.artist || 'Unknown artist',
      songId: song.id,
    });

    const amountCentsToLog =
      amountCentsOverride ?? amountCents ?? venue?.settings?.requestPriceCents ?? 1000;
    db.addPayment(venueCode, amountCentsToLog, checkoutId);
    return true;
  } finally {
    inFlightCheckouts.delete(checkoutId);
  }
}

module.exports = { fulfillPaidRequest };
