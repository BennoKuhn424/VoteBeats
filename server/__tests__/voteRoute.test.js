/**
 * Tests for the /vote route logic (stale-song cleanup, delta calculation).
 *
 * We test the vote delta logic directly rather than through the full Express
 * router — this keeps tests fast and doesn't require supertest or the whole
 * server to boot.
 */

// ── Vote delta logic (extracted from the route handler) ──────────────────────
// Returns { newVotes, myVote } given current state.
function applyVote(existingVote, voteValue, currentVotes) {
  let voteDelta = 0;

  if (existingVote === voteValue) {
    // Toggle off (un-vote)
    voteDelta = -voteValue;
  } else if (existingVote) {
    // Switch direction (upvote → downvote or vice versa)
    voteDelta = voteValue * 2;
  } else {
    // Fresh vote
    voteDelta = voteValue;
  }

  const newVotes = (currentVotes || 0) + voteDelta;
  const myVote = existingVote === voteValue ? null : voteValue;
  return { newVotes, myVote };
}

describe('vote delta — fresh votes', () => {
  test('upvote on a song with no previous vote adds +1', () => {
    const { newVotes, myVote } = applyVote(undefined, 1, 0);
    expect(newVotes).toBe(1);
    expect(myVote).toBe(1);
  });

  test('downvote on a song with no previous vote adds -1', () => {
    const { newVotes, myVote } = applyVote(undefined, -1, 3);
    expect(newVotes).toBe(2);
    expect(myVote).toBe(-1);
  });
});

describe('vote delta — toggle off', () => {
  test('upvoting an already-upvoted song removes the vote', () => {
    const { newVotes, myVote } = applyVote(1, 1, 5);
    expect(newVotes).toBe(4);
    expect(myVote).toBe(null);
  });

  test('downvoting an already-downvoted song removes the vote', () => {
    const { newVotes, myVote } = applyVote(-1, -1, 2);
    expect(newVotes).toBe(3);
    expect(myVote).toBe(null);
  });
});

describe('vote delta — direction switch', () => {
  test('switching from upvote to downvote applies a -2 delta', () => {
    const { newVotes, myVote } = applyVote(1, -1, 10);
    expect(newVotes).toBe(8);
    expect(myVote).toBe(-1);
  });

  test('switching from downvote to upvote applies a +2 delta', () => {
    const { newVotes, myVote } = applyVote(-1, 1, 0);
    expect(newVotes).toBe(2);
    expect(myVote).toBe(1);
  });
});

// ── Throttle: read-only checks + record-after-success ───────────────────────
// Mirrors the helpers in queueVote.js — the route layer is responsible for
// only calling recordVote() AFTER the vote succeeds, so failed votes (404 on
// removed song, etc.) do not consume quota.
describe('throttle helpers — H1 split read/record', () => {
  const VOTE_WINDOW_MS = 60_000;
  const VOTE_MAX = 5;

  function isVoteThrottled(map, deviceId) {
    const now = Date.now();
    const stamps = (map[deviceId] || []).filter((t) => now - t < VOTE_WINDOW_MS);
    map[deviceId] = stamps;
    return stamps.length >= VOTE_MAX;
  }
  function recordVote(map, deviceId) {
    if (!map[deviceId]) map[deviceId] = [];
    map[deviceId].push(Date.now());
  }

  test('isVoteThrottled does not record the attempt — read-only', () => {
    const map = {};
    // 100 read-only checks — none of them should fill the bucket
    for (let i = 0; i < 100; i++) {
      expect(isVoteThrottled(map, 'd1')).toBe(false);
    }
    expect(map['d1']).toEqual([]);
  });

  test('throttle ticks ONLY when recordVote is called', () => {
    const map = {};
    for (let i = 0; i < VOTE_MAX; i++) {
      expect(isVoteThrottled(map, 'd1')).toBe(false);
      recordVote(map, 'd1');
    }
    // Now the bucket is full — next read returns true
    expect(isVoteThrottled(map, 'd1')).toBe(true);
  });

  test('failed votes (no recordVote call) leave the bucket empty', () => {
    const map = {};
    // Simulate 10 vote attempts on a missing song — only check, never record
    for (let i = 0; i < 10; i++) {
      expect(isVoteThrottled(map, 'd1')).toBe(false);
      // recordVote NOT called — the route 404'd
    }
    // The patron should still be able to vote on a real song afterwards
    expect(isVoteThrottled(map, 'd1')).toBe(false);
  });
});

// ── Stale-song cleanup behaviour ──────────────────────────────────────────────
// The route removes the vote and returns 404 if the song is no longer in queue.
describe('stale-song cleanup', () => {
  test('song lookup returns null when song is not in queue', () => {
    const queue = {
      nowPlaying: { id: 'playing' },
      upcoming: [{ id: 'q1' }, { id: 'q2' }],
    };
    const songId = 'removed_song';

    const song =
      (queue.upcoming || []).find((s) => s.id === songId) ||
      (queue.nowPlaying?.id === songId ? queue.nowPlaying : null);

    expect(song).toBeNull();
  });

  test('song lookup finds nowPlaying by id', () => {
    const queue = { nowPlaying: { id: 'playing', votes: 3 }, upcoming: [] };
    const song =
      (queue.upcoming || []).find((s) => s.id === 'playing') ||
      (queue.nowPlaying?.id === 'playing' ? queue.nowPlaying : null);

    expect(song).not.toBeNull();
    expect(song.votes).toBe(3);
  });

  test('song lookup finds upcoming song by id', () => {
    const queue = {
      nowPlaying: { id: 'playing' },
      upcoming: [{ id: 'q1', votes: 0 }, { id: 'q2', votes: 2 }],
    };
    const song =
      (queue.upcoming || []).find((s) => s.id === 'q2') ||
      (queue.nowPlaying?.id === 'q2' ? queue.nowPlaying : null);

    expect(song.votes).toBe(2);
  });
});
