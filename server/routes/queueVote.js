const db = require('../utils/database');
const queueRepo = require('../repos/queueRepo');
const broadcast = require('../utils/broadcast');
const { logEvent } = require('../utils/logEvent');
const E = require('../utils/errorCodes');
const validate = require('../middleware/validate');
const { voteSchema } = require('../utils/schemas');

// ── Vote throttles ───────────────────────────────────────────────────────────
// Two layers, applied independently:
//   1. Per-device: max 5 votes per direction per device per 60s. Stops a single
//      patron from spamming. Cheap to bypass by rotating localStorage IDs.
//   2. Per-IP: max 30 votes per IP per 60s (across both directions). Stops the
//      "rotate device IDs in a loop" attack — an attacker would also need to
//      rotate IPs, which is far more expensive. NAT'd venues are unaffected
//      because 30/min is well above legitimate traffic from a single venue.
const downvoteTimestamps = {}; // { deviceId: [ts, ts, …] }
const upvoteTimestamps = {};   // { deviceId: [ts, ts, …] }
const ipTimestamps = {};       // { ip: [ts, ts, …] }
const VOTE_WINDOW_MS = 60_000;
const VOTE_MAX = 5;
const IP_VOTE_MAX = 30;
const VOTE_MAP_MAX_KEYS = 10_000;
let lastThrottlePrune = Date.now();

function pruneStaleKeys(map, now) {
  for (const id of Object.keys(map)) {
    const stamps = map[id];
    if (!stamps.length || stamps[stamps.length - 1] < now - VOTE_WINDOW_MS) {
      delete map[id];
    }
  }
}

function maybePruneAll(now) {
  if (
    now - lastThrottlePrune > 600_000 ||
    Object.keys(downvoteTimestamps).length > VOTE_MAP_MAX_KEYS ||
    Object.keys(upvoteTimestamps).length > VOTE_MAP_MAX_KEYS ||
    Object.keys(ipTimestamps).length > VOTE_MAP_MAX_KEYS
  ) {
    lastThrottlePrune = now;
    pruneStaleKeys(downvoteTimestamps, now);
    pruneStaleKeys(upvoteTimestamps, now);
    pruneStaleKeys(ipTimestamps, now);
  }
}

/**
 * Read-only check: would this caller be throttled right now?
 * Trims expired timestamps as a side-effect (cheap; the entry is already loaded).
 * Does NOT record the current attempt — call recordVote() AFTER the vote
 * succeeds so failed lookups (e.g. votes on already-removed songs) don't
 * burn the patron's quota.
 */
function isVoteThrottled(map, deviceId) {
  const now = Date.now();
  maybePruneAll(now);
  const stamps = (map[deviceId] || []).filter((t) => now - t < VOTE_WINDOW_MS);
  map[deviceId] = stamps;
  return stamps.length >= VOTE_MAX;
}

function isIpThrottled(ip) {
  if (!ip) return false; // missing IP shouldn't hard-fail; per-device guard still applies
  const now = Date.now();
  const stamps = (ipTimestamps[ip] || []).filter((t) => now - t < VOTE_WINDOW_MS);
  ipTimestamps[ip] = stamps;
  return stamps.length >= IP_VOTE_MAX;
}

/** Record a successful vote against the per-device direction map + per-IP window. */
function recordVote(deviceId, voteValue, ip) {
  const now = Date.now();
  const dirMap = voteValue === -1 ? downvoteTimestamps : upvoteTimestamps;
  if (deviceId) {
    if (!dirMap[deviceId]) dirMap[deviceId] = [];
    dirMap[deviceId].push(now);
  }
  if (ip) {
    if (!ipTimestamps[ip]) ipTimestamps[ip] = [];
    ipTimestamps[ip].push(now);
  }
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

    // Per-IP guard runs first so an attacker rotating deviceIds still hits a wall.
    // 30/min/IP is well above any legitimate single-venue traffic.
    if (isIpThrottled(req.ip)) {
      return res.status(429).json({ error: 'Too many votes from this network — slow down', code: E.VOTE_RATE_LIMITED_DOWN });
    }

    if (voteValue === -1 && isVoteThrottled(downvoteTimestamps, deviceId)) {
      return res.status(429).json({ error: 'Too many downvotes — slow down', code: E.VOTE_RATE_LIMITED_DOWN });
    }

    if (voteValue === 1 && isVoteThrottled(upvoteTimestamps, deviceId)) {
      return res.status(429).json({ error: 'Too many upvotes — slow down', code: E.VOTE_RATE_LIMITED_UP });
    }

    let result = null;

    const updated = await queueRepo.update(venueCode, (queue) => {
      // Look up the song FIRST so we never write a vote row for a song that's
      // already gone — saves a write+rollback cycle inside the transaction and
      // keeps the votes table in lock-step with the queue.
      const targetSong =
        (queue.upcoming || []).find((s) => s.id === songId) ||
        (queue.nowPlaying?.id === songId ? queue.nowPlaying : null);

      if (!targetSong) {
        result = { error: true, status: 404, body: { error: 'Song is no longer in the queue', code: E.VOTE_SONG_NOT_FOUND } };
        return null;
      }

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

    // Only record the throttle hit AFTER a successful vote so failed lookups
    // (vote on already-removed songs, etc.) don't burn the patron's quota.
    recordVote(deviceId, voteValue, req.ip);

    broadcast.broadcastQueue(venueCode, updated);
    res.json({ success: true, ...result });
  });
}

module.exports = attachVoteRoutes;
