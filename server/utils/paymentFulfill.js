const { v4: uuidv4 } = require('uuid');
const db = require('./database');
const queueRepo = require('../repos/queueRepo');

/**
 * Fulfill a paid song request: add song to queue, log payment, remove pending.
 * Idempotent: safe to call multiple times (e.g. webhook + polling).
 */
async function fulfillPaidRequest(checkoutId, amountCentsOverride) {
  const pending = db.getPendingPayment(checkoutId);
  if (!pending) return false;

  const { venueCode, song: songData, deviceId, amountCents } = pending;
  const venue = db.getVenue(venueCode);
  if (!venue) {
    db.removePendingPayment(checkoutId);
    return false;
  }

  const song = {
    ...songData,
    id: songData.id || `song_${uuidv4()}`,
    votes: 0,
    requestedBy: deviceId,
    requestedAt: Date.now(),
  };

  await queueRepo.update(venueCode, (queue) => {
    // If nothing is playing, promote directly to nowPlaying so it starts immediately
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
  db.removePendingPayment(checkoutId);
  return true;
}

module.exports = { fulfillPaidRequest };
