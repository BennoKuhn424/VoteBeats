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
    nowPlaying: { ...nextSong, startedAt: Date.now() },
    upcoming: rest,
  });
}

module.exports = { advanceToNextSong };
