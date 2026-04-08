let _io = null;

/**
 * Bind the Socket.IO server instance. Must be called once at startup before
 * any broadcast functions are used.
 * @param {import('socket.io').Server} io
 */
function init(io) {
  _io = io;
}

/**
 * Emit the full queue state to every client connected to a venue room.
 * Called after any state-changing operation (request, vote, skip, pause, resume, advance).
 * @param {string} venueCode
 * @param {object} queue - Full queue object ({ nowPlaying, upcoming, … })
 */
function broadcastQueue(venueCode, queue) {
  if (!_io || !venueCode || !queue) return;
  try {
    _io.to(`venue:${venueCode}`).emit('queue:updated', queue);
  } catch (err) {
    console.error('[broadcast] queue:updated emit failed:', err);
  }
}

/**
 * Broadcast a customer volume suggestion to the venue dashboard.
 * @param {string} venueCode
 * @param {{ direction: 'too_loud'|'too_soft', volumePercent: number|null, at: number }} payload
 */
function broadcastVolumeFeedback(venueCode, payload) {
  if (!_io || !venueCode || !payload) return;
  try {
    _io.to(`venue:${venueCode}`).emit('volume:feedback', payload);
  } catch (err) {
    console.error('[broadcast] volume:feedback emit failed:', err);
  }
}

/**
 * Return the number of live Socket.IO connections (customers + venue dashboards).
 * Approximate — counts transport connections, not unique users.
 * @returns {number}
 */
function getConnectedCount() {
  if (!_io) return 0;
  try {
    return _io.engine?.clientsCount ?? 0;
  } catch (_) {
    return 0;
  }
}

module.exports = { init, broadcastQueue, broadcastVolumeFeedback, getConnectedCount };
