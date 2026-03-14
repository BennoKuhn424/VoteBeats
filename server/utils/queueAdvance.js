const db = require('./database');

function advanceToNextSong(venueCode) {
  const queue = db.getQueue(venueCode);

  if (queue.upcoming.length === 0) {
    db.updateQueue(venueCode, { nowPlaying: null, upcoming: [] });
    return;
  }

  // Play songs in strict purchase / request order (FIFO)
  const [nextSong, ...rest] = queue.upcoming;

  db.updateQueue(venueCode, {
    nowPlaying: {
      ...nextSong,
      // Anchor pattern: positionMs=0 at the moment playback starts
      positionMs: 0,
      positionAnchoredAt: Date.now(),
      isPaused: false,
    },
    upcoming: rest,
  });
}

module.exports = { advanceToNextSong };
