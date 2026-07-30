const { randomUUID: uuidv4 } = require('crypto');
const db = require('./database');
const queueRepo = require('../repos/queueRepo');

/**
 * In-flight guard: prevents the webhook and polling paths from fulfilling the
 * same checkoutId concurrently (the DB remove is not atomic with the queue write).
 */
const inFlightCheckouts = new Set();

/**
 * Fulfill a paid song request: log payment, add song to queue, remove pending.
 *
 * Idempotency strategy:
 *  1. In-flight Set prevents two concurrent calls for the same checkoutId.
 *  2. `removePendingPayment` runs BEFORE the queue write so a crash after
 *     removal but before the write loses the song (safe) rather than adding
 *     it twice (unsafe — user charged once, song appears twice).
 *  3. The payment row is written BEFORE the queue write, so a failing queue
 *     write cannot erase the fact that the patron was charged. `addPayment` is
 *     idempotent per checkout, so ordering it first risks nothing.
 */
async function fulfillPaidRequest(checkoutId, amountCentsOverride) {
  // ── Idempotent: already fulfilled or no record ──
  const pending = db.getPendingPayment(checkoutId);
  if (!pending) return false;

  // ── Only song requests belong in the queue ──
  // pending_payments is shared with AI playlist-generation checkouts, which
  // arrive through the SAME provider webhook. Fulfilling one here would push a
  // song-shaped blank into the venue's live queue and book a platform fee as
  // venue patron revenue — money the payout split would then hand 70% of to
  // the venue. Leave the row alone: routes/venue.js owns that flow.
  if (pending.kind && pending.kind !== 'song_request') return false;

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

    // ── Record the money FIRST ──
    // The patron has already been charged by this point. If the queue write
    // below throws, the song is lost but the venue is still credited — the
    // alternative (booking last) silently dropped the payment from the ledger
    // entirely, so nothing surfaced it and no payout ever included it.
    const amountCentsToLog =
      amountCentsOverride ?? amountCents ?? venue?.settings?.requestPriceCents ?? 1000;
    db.addPayment(venueCode, amountCentsToLog, checkoutId);

    // ── Remove pending (crash-safe: lose the song, not double-add) ──
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

    return true;
  } finally {
    inFlightCheckouts.delete(checkoutId);
  }
}

module.exports = { fulfillPaidRequest };
