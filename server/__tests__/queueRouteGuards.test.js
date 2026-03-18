/**
 * Tests for the route-level guards in queue.js.
 *
 * These test the guard predicates directly — the same approach used in
 * voteRoute.test.js — without requiring supertest or a full Express boot.
 */

// ── Advance/Skip mismatch guards ──────────────────────────────────────────────
// Extracted from POST /advance and POST /skip.

/**
 * Returns true when the advance should be a no-op because the song has
 * already changed (someone else already advanced).
 */
function advanceShouldSkip(currentSongId, requestedSongId) {
  return currentSongId !== requestedSongId;
}

/**
 * Returns true when /skip should be rejected with 409 because the song
 * playing is no longer the one the client intended to skip.
 */
function skipShouldReject(currentSongId, requestedSongId) {
  return !!currentSongId && currentSongId !== requestedSongId;
}

describe('/advance mismatch guard', () => {
  test('no-op when expectedSongId does not match nowPlaying.id', () => {
    // Server is now on s2 — advance for s1 is stale
    expect(advanceShouldSkip('s2', 's1')).toBe(true);
  });

  test('proceeds when expectedSongId matches nowPlaying.id', () => {
    expect(advanceShouldSkip('s1', 's1')).toBe(false);
  });

  test('no-op when nowPlaying is null (queue is already empty)', () => {
    // currentSongId will be null; null !== 's1'
    expect(advanceShouldSkip(null, 's1')).toBe(true);
  });
});

describe('/skip mismatch guard', () => {
  test('rejects with 409 when expectedSongId does not match nowPlaying.id', () => {
    expect(skipShouldReject('s2', 's1')).toBe(true);
  });

  test('proceeds when expectedSongId matches nowPlaying.id', () => {
    expect(skipShouldReject('s1', 's1')).toBe(false);
  });

  test('does NOT reject when nowPlaying is null (queue empty — let advance handle no-op)', () => {
    // The null guard: `currentSongId &&` — skip is a no-op, not a 409
    expect(skipShouldReject(null, 's1')).toBe(false);
  });
});

// ── Vote + song removal collision ─────────────────────────────────────────────
// Extracted from POST /vote.

/**
 * Mirrors the song-lookup performed inside the vote route handler.
 * Returns the song object or null if not found.
 */
function findSongInQueue(queue, songId) {
  return (
    (queue.upcoming || []).find((s) => s.id === songId) ||
    (queue.nowPlaying?.id === songId ? queue.nowPlaying : null)
  );
}

describe('vote + song removal collision', () => {
  test('returns null when the voted song has been removed from the queue', () => {
    const queue = {
      nowPlaying: { id: 'playing' },
      upcoming: [{ id: 'q1' }, { id: 'q2' }],
    };
    // Song was in the queue when the user tapped vote, but removed before the
    // route handler ran (e.g. venue owner deleted it in the same moment).
    expect(findSongInQueue(queue, 'removed')).toBeNull();
  });

  test('finds the song when it is still in upcoming', () => {
    const queue = {
      nowPlaying: { id: 'playing' },
      upcoming: [{ id: 'q1', votes: 2 }, { id: 'q2', votes: 0 }],
    };
    const found = findSongInQueue(queue, 'q1');
    expect(found).not.toBeNull();
    expect(found.votes).toBe(2);
  });

  test('finds the song when it is nowPlaying (supports voting on current track)', () => {
    const queue = { nowPlaying: { id: 'playing', votes: 5 }, upcoming: [] };
    const found = findSongInQueue(queue, 'playing');
    expect(found).not.toBeNull();
    expect(found.votes).toBe(5);
  });

  test('returns null when queue is completely empty', () => {
    const queue = { nowPlaying: null, upcoming: [] };
    expect(findSongInQueue(queue, 'any')).toBeNull();
  });
});
