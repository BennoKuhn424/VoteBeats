const { v4: uuidv4 } = require('uuid');
const db = require('./database');

/**
 * Fulfill a paid song request: add song to queue, log payment, remove pending.
 * Idempotent: safe to call multiple times (e.g. webhook + polling).
 */
function fulfillPaidRequest(checkoutId, amountCentsOverride) {
  const pending = db.getPendingPayment(checkoutId);
  if (!pending) return false;

  const { venueCode, song: songData, deviceId, amountCents } = pending;
  const venue = db.getVenue(venueCode);
  if (!venue) {
    db.removePendingPayment(checkoutId);
    return false;
  }

  const queue = db.getQueue(venueCode);
  const song = {
    ...songData,
    id: songData.id || `song_${uuidv4()}`,
    votes: 0,
    requestedBy: deviceId,
    requestedAt: Date.now(),
  };

  const updatedQueue = {
    nowPlaying: queue.nowPlaying,
    upcoming: [...(queue.upcoming || []), song],
  };
  db.updateQueue(venueCode, updatedQueue);

  const amountCentsToLog =
    amountCentsOverride ?? amountCents ?? venue?.settings?.requestPriceCents ?? 1000;
  db.addPayment(venueCode, amountCentsToLog, checkoutId);
  db.removePendingPayment(checkoutId);
  return true;
}

module.exports = { fulfillPaidRequest };
