const queueRepo = require('../repos/queueRepo');

/**
 * Advance the queue to the next song.
 *
 * Uses queueRepo.update so the read-modify-write is protected by the
 * per-venue mutex — concurrent /advance and /skip calls are serialised
 * and can never skip two songs by racing each other.
 *
 * Pass expectedSongId to guard against double-advance races (client
 * /advance and a server-side poll can fire simultaneously when a song ends).
 *
 * Returns the new queue state (or the unchanged queue if the guard fired).
 */
async function advanceToNextSong(venueCode, expectedSongId) {
  return queueRepo.update(venueCode, (queue) => {
    // If the caller specified which song should be current and it no longer is,
    // another advance already ran — return null (no-op) to avoid skipping twice.
    if (expectedSongId && queue.nowPlaying?.id !== expectedSongId) return null;

    if (!queue.upcoming || queue.upcoming.length === 0) {
      return { nowPlaying: null, upcoming: [] };
    }

    const [nextSong, ...rest] = queue.upcoming;
    return {
      nowPlaying: {
        ...nextSong,
        positionMs: 0,
        positionAnchoredAt: Date.now(),
        isPaused: false,
      },
      upcoming: rest,
    };
  });
}

module.exports = { advanceToNextSong };
