const db = require('../utils/database');
const queueRepo = require('../repos/queueRepo');
const broadcast = require('../utils/broadcast');
const { logEvent } = require('../utils/logEvent');
const E = require('../utils/errorCodes');
const validate = require('../middleware/validate');
const { voteSchema } = require('../utils/schemas');

// ── Vote throttle: max 5 votes per direction per device per 60s ──────────────
const downvoteTimestamps = {}; // { deviceId: [ts, ts, …] }
const upvoteTimestamps = {};   // { deviceId: [ts, ts, …] }
const VOTE_WINDOW_MS = 60_000;
const VOTE_MAX = 5;
const VOTE_MAP_MAX_KEYS = 10_000;
let lastThrottlePrune = Date.now();

function isVoteThrottled(map, deviceId) {
  const now = Date.now();

  // Prune stale entries every 10 minutes or when the map grows too large
  const keys = Object.keys(map);
  if (now - lastThrottlePrune > 600_000 || keys.length > VOTE_MAP_MAX_KEYS) {
    lastThrottlePrune = now;
    for (const id of keys) {
      const stamps = map[id];
      if (!stamps.length || stamps[stamps.length - 1] < now - VOTE_WINDOW_MS) {
        delete map[id];
      }
    }
  }

  const stamps = (map[deviceId] || []).filter((t) => now - t < VOTE_WINDOW_MS);
  map[deviceId] = stamps;
  if (stamps.length >= VOTE_MAX) return true;
  stamps.push(now);
  return false;
}

const DOWNVOTE_REMOVAL_THRESHOLD = -3;

/**
 * POST /api/queue/:venueCode/vote
 */
function attachVoteRoutes(router) {
  router.post('/:venueCode/vote', validate(voteSchema), async (req, res) => {
    const { venueCode } = req.params;
    const { songId, voteValue, deviceId } = req.body;

    if (!db.getVenue(venueCode)) {
      return res.status(404).json({ error: 'Venue not found', code: E.QUEUE_VENUE_NOT_FOUND });
    }

    if (voteValue === -1 && isVoteThrottled(downvoteTimestamps, deviceId)) {
      return res.status(429).json({ error: 'Too many downvotes — slow down', code: E.VOTE_RATE_LIMITED_DOWN });
    }

    if (voteValue === 1 && isVoteThrottled(upvoteTimestamps, deviceId)) {
      return res.status(429).json({ error: 'Too many upvotes — slow down', code: E.VOTE_RATE_LIMITED_UP });
    }

    let result = null;

    const updated = await queueRepo.update(venueCode, (queue) => {
      const existingVote = db.getVote(venueCode, songId, deviceId);
      let voteDelta = 0;
      if (existingVote === voteValue) {
        db.removeVote(venueCode, songId, deviceId);
        voteDelta = -voteValue;
      } else if (existingVote) {
        db.setVote(venueCode, songId, deviceId, voteValue);
        voteDelta = voteValue * 2;
      } else {
        db.setVote(venueCode, songId, deviceId, voteValue);
        voteDelta = voteValue;
      }

      const targetSong =
        (queue.upcoming || []).find((s) => s.id === songId) ||
        (queue.nowPlaying?.id === songId ? queue.nowPlaying : null);

      if (!targetSong) {
        db.removeVote(venueCode, songId, deviceId);
        result = { error: true, status: 404, body: { error: 'Song is no longer in the queue', code: E.VOTE_SONG_NOT_FOUND } };
        return null;
      }

      const newVoteCount = (targetSong.votes || 0) + voteDelta;
      const myVote = existingVote === voteValue ? null : voteValue;

      if (newVoteCount <= DOWNVOTE_REMOVAL_THRESHOLD && queue.nowPlaying?.id !== songId) {
        db.clearVotesForSong(venueCode, songId);
        logEvent({ venueCode, action: 'vote-remove', songId, detail: `auto-removed at ${newVoteCount} votes` });
        result = { newVoteCount, removed: true, myVote: null };
        return { ...queue, upcoming: (queue.upcoming || []).filter((s) => s.id !== songId) };
      }

      if (voteDelta !== 0) {
        db.recordAnalyticsEvent(venueCode, { type: 'vote', songId, voteValue: myVote, songTitle: targetSong.title, artist: targetSong.artist });
      }
      logEvent({ venueCode, action: 'vote', songId, detail: `delta=${voteDelta}` });

      result = { newVoteCount, myVote };

      const updateVotes = (s) =>
        s.id === songId ? { ...s, votes: (s.votes || 0) + voteDelta } : s;
      return {
        nowPlaying: queue.nowPlaying?.id === songId
          ? { ...queue.nowPlaying, votes: (queue.nowPlaying.votes || 0) + voteDelta }
          : queue.nowPlaying,
        upcoming: (queue.upcoming || []).map(updateVotes),
      };
    });

    if (result?.error) {
      return res.status(result.status).json(result.body);
    }

    broadcast.broadcastQueue(venueCode, updated);
    res.json({ success: true, ...result });
  });
}

module.exports = attachVoteRoutes;
