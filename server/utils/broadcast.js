let _io = null;

function init(io) {
  _io = io;
}

/**
 * Emit the full queue state to every client connected to a venue room.
 * Called after any state-changing operation (request, vote, skip, pause, resume, advance).
 */
function broadcastQueue(venueCode, queue) {
  if (_io && venueCode && queue) {
    _io.to(`venue:${venueCode}`).emit('queue:updated', queue);
  }
}

module.exports = { init, broadcastQueue };
