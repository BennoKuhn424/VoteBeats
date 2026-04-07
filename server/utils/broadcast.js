let _io = null;

function init(io) {
  _io = io;
}

/**
 * Emit the full queue state to every client connected to a venue room.
 * Called after any state-changing operation (request, vote, skip, pause, resume, advance).
 */
function broadcastQueue(venueCode, queue) {
  if (!_io || !venueCode || !queue) return;
  try {
    _io.to(`venue:${venueCode}`).emit('queue:updated', queue);
  } catch (err) {
    console.error('[broadcast] queue:updated emit failed:', err);
  }
}

/** Customer volume suggestion — venue dashboard listens for live alerts */
function broadcastVolumeFeedback(venueCode, payload) {
  if (!_io || !venueCode || !payload) return;
  try {
    _io.to(`venue:${venueCode}`).emit('volume:feedback', payload);
  } catch (err) {
    console.error('[broadcast] volume:feedback emit failed:', err);
  }
}

/** Live Socket.IO connections (customers + venue dashboards; approximate “active users”). */
function getConnectedCount() {
  if (!_io) return 0;
  try {
    return _io.engine?.clientsCount ?? 0;
  } catch (_) {
    return 0;
  }
}

module.exports = { init, broadcastQueue, broadcastVolumeFeedback, getConnectedCount };
