const db = require('./database');

// Pass expectedSongId to guard against double-advance races (client /advance
// and server poll can both trigger simultaneously when a song ends).
function advanceToNextSong(venueCode, expectedSongId) {
  const queue = db.getQueue(venueCode);

  // If the caller specified which song should be current and it no longer is,
  // another advance already ran — bail out to avoid skipping an extra song.
  if (expectedSongId && queue.nowPlaying?.id !== expectedSongId) return;

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
