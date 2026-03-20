const express = require('express');
const db = require('../utils/database');
const { v4: uuidv4 } = require('uuid');
const authMiddleware = require('../middleware/authMiddleware');
const { advanceToNextSong } = require('../utils/queueAdvance');
const { fulfillPaidRequest } = require('../utils/paymentFulfill');
const { searchByGenre, pickFromPlaylist } = require('../utils/appleMusicAPI');
const broadcast = require('../utils/broadcast');
const { logEvent } = require('../utils/logEvent');
const queueRepo = require('../repos/queueRepo');

const router = express.Router();

// ── Anchor-pattern helper ─────────────────────────────────────────────────────
function getCurrentPositionMs(np) {
  if (!np) return 0;
  const posMs = np.positionMs ?? 0;
  const anchoredAt = np.positionAnchoredAt ?? np.startedAt ?? Date.now();
  if (np.isPaused || np.pausedAt) return posMs;
  return posMs + (Date.now() - anchoredAt);
}

// ── Server-side autofill ──────────────────────────────────────────────────────
// pendingAutofillVenues prevents a second concurrent autofill from starting
// while one is already awaiting the Apple Music search.  The queueRepo lock
// inside the write provides a second line of defence: even if two callers
// pass the outer check simultaneously, only one will commit (the re-check
// inside the lock catches the second one).
const pendingAutofillVenues = new Set();

async function serverAutofill(venueCode, venue) {
  if (pendingAutofillVenues.has(venueCode)) return;
  pendingAutofillVenues.add(venueCode);
  try {
    // Fast path: check outside the lock (avoids lock contention on busy venues)
    const preCheck = queueRepo.get(venueCode);
    if (preCheck.nowPlaying || (preCheck.upcoming && preCheck.upcoming.length > 0)) return;

    const genreSetting = venue?.settings?.autoplayGenre;
    const genres = Array.isArray(genreSetting) ? genreSetting : (genreSetting ? [genreSetting] : []);
    const autoplayMode = venue?.settings?.autoplayMode || 'playlist';
    const playlists = venue?.playlists || [];

    // Dayparting: check if a playlist is scheduled for the current hour
    let activePl = null;
    const schedule = venue?.settings?.playlistSchedule;
    if (Array.isArray(schedule) && schedule.length > 0) {
      const now = new Date();
      const currentHour = now.getHours();
      const currentDay = now.getDay(); // 0=Sun, 1=Mon, ...
      const slot = schedule.find((s) => {
        const hourMatch = s.startHour <= s.endHour
          ? currentHour >= s.startHour && currentHour < s.endHour
          : currentHour >= s.startHour || currentHour < s.endHour; // wraps midnight
        if (!hourMatch) return false;
        if (Array.isArray(s.days) && s.days.length > 0) return s.days.includes(currentDay);
        return true; // no day restriction
      });
      if (slot) activePl = playlists.find((p) => p.id === slot.playlistId);
    }
    if (!activePl) {
      activePl = playlists.find((p) => p.id === venue?.activePlaylistId)
        || playlists.find((p) => p.songs?.length > 0);
    }
    const playlist = activePl?.songs || venue?.playlist || [];

    let song = null;
    if (autoplayMode !== 'random' && playlist.length > 0) {
      song = pickFromPlaylist(playlist, venueCode);
    }
    if (!song) {
      song = await searchByGenre(genres, venueCode); // ← only async step
    }
    if (!song) return;

    const now = Date.now();
    const autofillSong = {
      ...song,
      id: song.id || `autofill_${now}`,
      votes: 0,
      requestedBy: '__autofill__',
      requestedAt: now,
      positionMs: 0,
      positionAnchoredAt: now,
      isPaused: false,
    };

    // Locked write with re-check inside: another request may have filled the
    // queue between the outer check and now (while we were awaiting searchByGenre).
    const written = await queueRepo.update(venueCode, (queue) => {
      if (queue.nowPlaying || (queue.upcoming && queue.upcoming.length > 0)) return null;
      return { nowPlaying: autofillSong, upcoming: [] };
    });

    if (written.nowPlaying?.id === autofillSong.id) {
      logEvent({ venueCode, action: 'autofill', songId: autofillSong.id, detail: `"${autofillSong.title}" autofilled (server)` });
      broadcast.broadcastQueue(venueCode, written);
    }
  } finally {
    pendingAutofillVenues.delete(venueCode);
  }
}

// GET /api/queue/:venueCode?deviceId=xxx
router.get('/:venueCode', async (req, res) => {
  const { venueCode } = req.params;
  const { deviceId } = req.query;
  let queue = queueRepo.get(venueCode);
  const venue = db.getVenue(venueCode);

  // Auto-advance based on anchor position — safety net only.
  // The client's MusicKit song-end event (mk===5) is the primary trigger.
  const np = queue.nowPlaying;
  if (np && !np.isPaused && !np.pausedAt) {
    let durationMs = (np.duration || 0) * 1000;
    if (durationMs < 30000) durationMs = 600000; // generous fallback
    const currentPos = getCurrentPositionMs(np);
    if (currentPos >= durationMs + 10000) {
      queue = await advanceToNextSong(venueCode, np.id);
      broadcast.broadcastQueue(venueCode, queue);
      if (!queue.nowPlaying) {
        const s = venue?.settings;
        if (s?.autoplayMode !== 'off' && s?.autoplayQueue !== false) {
          serverAutofill(venueCode, venue).catch(() => {});
        }
      }
    }
  }

  let myVotes = {};
  if (deviceId) {
    const votes = db.getVotesForDevice(venueCode, deviceId);
    myVotes = votes || {};
  }

  const autoplayGenre = venue?.settings?.autoplayGenre;
  const hasAutoplayGenre = Array.isArray(autoplayGenre) ? autoplayGenre.length > 0 : !!autoplayGenre;

  const requestSettings = venue?.settings
    ? {
        requirePaymentForRequest: venue.settings.requirePaymentForRequest ?? false,
        requestPriceCents: venue.settings.requestPriceCents ?? 1000,
        autoplayQueue: venue.settings.autoplayQueue ?? true,
        hasAutoplayGenre,
      }
    : { requirePaymentForRequest: false, requestPriceCents: 1000, autoplayQueue: true, hasAutoplayGenre: false };

  res.json({ ...queue, myVotes, requestSettings });
});

// POST /api/queue/:venueCode/request
router.post('/:venueCode/request', async (req, res) => {
  const { venueCode } = req.params;
  const { song, deviceId } = req.body;

  if (!song || !song.appleId || !song.title) {
    return res.status(400).json({ error: 'Song with appleId and title is required' });
  }
  if (!deviceId) {
    return res.status(400).json({ error: 'deviceId is required' });
  }

  const venue = db.getVenue(venueCode);
  if (!venue) {
    return res.status(404).json({ error: 'Venue not found' });
  }

  if (venue.settings?.requirePaymentForRequest) {
    return res.status(402).json({
      error: 'Payment required to request a song',
      requiresPayment: true,
      requestPriceCents: venue.settings.requestPriceCents ?? 1000,
    });
  }

  const songId = song.id || song.appleId;
  const maxPerUser = venue.settings?.maxSongsPerUser ?? 3;

  const newSong = {
    ...song,
    id: song.id || `song_${uuidv4()}`,
    votes: 0,
    requestedBy: deviceId,
    requestedAt: Date.now(),
  };

  try {
    // All validation inside the lock to prevent race conditions
    // (duplicate check + per-user limit are atomic with the write)
    let rejection = null;
    const updated = await queueRepo.update(venueCode, (queue) => {
      const upcoming = queue.upcoming || [];
      const np = queue.nowPlaying;
      const alreadyNowPlaying = np && ((np.id && np.id === songId) || (np.appleId && np.appleId === song.appleId));
      const alreadyInQueue = alreadyNowPlaying || upcoming.some(
        (s) => (s.id && s.id === songId) || (s.appleId && s.appleId === song.appleId)
      );
      if (alreadyInQueue) {
        rejection = { status: 400, body: { error: 'This song is already in the queue' } };
        return null; // no-op
      }
      if (upcoming.filter((s) => s.requestedBy === deviceId).length >= maxPerUser) {
        rejection = { status: 400, body: { error: `Max ${maxPerUser} songs per user` } };
        return null;
      }
      // If nothing is playing, promote directly to nowPlaying so it starts immediately
      if (!queue.nowPlaying) {
        return {
          nowPlaying: { ...newSong, positionMs: 0, positionAnchoredAt: Date.now(), isPaused: false },
          upcoming,
        };
      }
      return { nowPlaying: queue.nowPlaying, upcoming: [...upcoming, newSong] };
    });

    if (rejection) {
      return res.status(rejection.status).json(rejection.body);
    }

    logEvent({ venueCode, action: 'request', songId: newSong.id, detail: `"${newSong.title}" added to queue` });
    db.recordAnalyticsEvent(venueCode, { type: 'request', songTitle: newSong.title, artist: newSong.artist, songId: newSong.id });
    broadcast.broadcastQueue(venueCode, updated);
    res.json({ success: true, song: newSong });
  } catch (err) {
    console.error('Queue write error on /request:', err);
    res.status(500).json({ error: 'Could not add song to queue — please try again' });
  }
});

// ── Downvote throttle: max 5 downvotes per device per 60s ────────────────────
const downvoteTimestamps = {}; // { deviceId: [ts, ts, …] }
const DOWNVOTE_WINDOW_MS = 60_000;
const DOWNVOTE_MAX = 5;
let lastThrottlePrune = Date.now();

function isDownvoteThrottled(deviceId) {
  const now = Date.now();

  // Prune stale entries every 10 minutes to prevent memory leak
  if (now - lastThrottlePrune > 600_000) {
    lastThrottlePrune = now;
    for (const id of Object.keys(downvoteTimestamps)) {
      const stamps = downvoteTimestamps[id];
      if (!stamps.length || stamps[stamps.length - 1] < now - DOWNVOTE_WINDOW_MS) {
        delete downvoteTimestamps[id];
      }
    }
  }

  const stamps = (downvoteTimestamps[deviceId] || []).filter((t) => now - t < DOWNVOTE_WINDOW_MS);
  downvoteTimestamps[deviceId] = stamps;
  if (stamps.length >= DOWNVOTE_MAX) return true;
  stamps.push(now);
  return false;
}

// Downvote threshold: if net votes drop to this or below, remove from queue
const DOWNVOTE_REMOVAL_THRESHOLD = -3;

// POST /api/queue/:venueCode/vote
router.post('/:venueCode/vote', async (req, res) => {
  const { venueCode } = req.params;
  const { songId, voteValue, deviceId } = req.body;

  if (voteValue !== 1 && voteValue !== -1) {
    return res.status(400).json({ error: 'Invalid vote value' });
  }

  // Throttle downvotes to prevent trolling
  if (voteValue === -1 && isDownvoteThrottled(deviceId)) {
    return res.status(429).json({ error: 'Too many downvotes — slow down' });
  }

  // All vote logic inside the queue lock to prevent race conditions:
  // - vote DB read/write and queue update are atomic
  // - concurrent votes on the same song are serialised
  let result = null;

  const updated = await queueRepo.update(venueCode, (queue) => {
    // Compute vote delta from the votes table (inside lock)
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

    // Check that the song still exists
    const targetSong =
      (queue.upcoming || []).find((s) => s.id === songId) ||
      (queue.nowPlaying?.id === songId ? queue.nowPlaying : null);

    if (!targetSong) {
      db.removeVote(venueCode, songId, deviceId);
      result = { error: true, status: 404, body: { error: 'Song is no longer in the queue' } };
      return null; // no-op
    }

    const newVoteCount = (targetSong.votes || 0) + voteDelta;
    const myVote = existingVote === voteValue ? null : voteValue;

    // Auto-remove upcoming songs that drop to the threshold (never remove nowPlaying)
    if (newVoteCount <= DOWNVOTE_REMOVAL_THRESHOLD && queue.nowPlaying?.id !== songId) {
      db.clearVotesForSong(venueCode, songId);
      logEvent({ venueCode, action: 'vote-remove', songId, detail: `auto-removed at ${newVoteCount} votes` });
      result = { newVoteCount, removed: true, myVote: null };
      return { ...queue, upcoming: (queue.upcoming || []).filter((s) => s.id !== songId) };
    }

    // Track analytics
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

// POST /api/queue/:venueCode/playing
router.post('/:venueCode/playing', async (req, res) => {
  const { venueCode } = req.params;
  const { songId, positionSeconds } = req.body;

  const updated = await queueRepo.update(venueCode, (queue) => {
    if (!queue.nowPlaying ||
        (queue.nowPlaying.id !== songId && String(queue.nowPlaying.appleId) !== String(songId))) {
      return null; // no-op — song doesn't match
    }
    const pos = typeof positionSeconds === 'number' && positionSeconds > 0 ? positionSeconds : 0;
    const np = {
      ...queue.nowPlaying,
      positionMs: Math.round(pos * 1000),
      positionAnchoredAt: Date.now(),
      isPaused: false,
    };
    delete np.startedAt;
    delete np.pausedAt;
    return { ...queue, nowPlaying: np };
  });

  const matched = updated.nowPlaying?.id === songId ||
    String(updated.nowPlaying?.appleId) === String(songId);
  if (matched) broadcast.broadcastQueue(venueCode, updated);
  res.json({ success: true, matched });
});

// POST /api/queue/:venueCode/pause
router.post('/:venueCode/pause', async (req, res) => {
  const { venueCode } = req.params;
  const { songId } = req.body;

  // Read current position before the lock for the freeze calculation
  const pre = queueRepo.get(venueCode);
  const frozenPos = pre.nowPlaying ? getCurrentPositionMs(pre.nowPlaying) : 0;

  const updated = await queueRepo.update(venueCode, (queue) => {
    if (!queue.nowPlaying ||
        (queue.nowPlaying.id !== songId && String(queue.nowPlaying.appleId) !== String(songId))) {
      return null;
    }
    const np = {
      ...queue.nowPlaying,
      positionMs: frozenPos,
      positionAnchoredAt: Date.now(),
      isPaused: true,
    };
    delete np.startedAt;
    delete np.pausedAt;
    return { ...queue, nowPlaying: np };
  });

  const matched = updated.nowPlaying?.id === songId ||
    String(updated.nowPlaying?.appleId) === String(songId);
  if (matched) broadcast.broadcastQueue(venueCode, updated);
  res.json({ success: true, matched });
});

// POST /api/queue/:venueCode/advance
router.post('/:venueCode/advance', async (req, res) => {
  const { venueCode } = req.params;
  const { songId } = req.body;

  if (!songId) {
    return res.status(400).json({ error: 'songId required for advance' });
  }

  // Fast check — if already advanced, skip acquiring the lock
  const currentSongId = queueRepo.get(venueCode).nowPlaying?.id ?? null;
  if (currentSongId !== songId) {
    return res.json({ success: true, nowPlaying: queueRepo.get(venueCode).nowPlaying || null });
  }

  let queue = await advanceToNextSong(venueCode, songId);
  logEvent({ venueCode, action: 'advance', songId, detail: 'song ended — advancing' });

  // Fill empty queue synchronously so the client gets nowPlaying in one round-trip
  if (!queue.nowPlaying && (!queue.upcoming || queue.upcoming.length === 0)) {
    const venue = db.getVenue(venueCode);
    const s = venue?.settings;
    if (s?.autoplayMode !== 'off' && s?.autoplayQueue !== false) {
      await serverAutofill(venueCode, venue).catch(() => {});
      queue = queueRepo.get(venueCode);
    }
  }

  broadcast.broadcastQueue(venueCode, queue);
  res.json({ success: true, nowPlaying: queue.nowPlaying || null });
});

// POST /api/queue/:venueCode/skip (venue owner only)
router.post('/:venueCode/skip', authMiddleware, async (req, res) => {
  if (req.venue.code !== req.params.venueCode) {
    return res.status(403).json({ error: 'Unauthorized' });
  }
  const { venueCode } = req.params;
  const { songId } = req.body;

  if (!songId) {
    return res.status(400).json({ error: 'songId required for skip' });
  }

  const currentSongId = queueRepo.get(venueCode).nowPlaying?.id;
  if (currentSongId && currentSongId !== songId) {
    return res.status(409).json({ error: 'Skip rejected — song already changed', currentSongId });
  }

  const queue = await advanceToNextSong(venueCode, songId);
  logEvent({ venueCode, action: 'skip', songId, detail: 'venue owner skipped song' });
  broadcast.broadcastQueue(venueCode, queue);
  res.json({ success: true });
});

// DELETE /api/queue/:venueCode/song/:songId (venue owner only)
router.delete('/:venueCode/song/:songId', authMiddleware, async (req, res) => {
  const { venueCode, songId } = req.params;

  if (req.venue.code !== venueCode) {
    return res.status(403).json({ error: 'Unauthorized' });
  }

  const updated = await queueRepo.update(venueCode, (queue) => ({
    ...queue,
    upcoming: (queue.upcoming || []).filter((s) => s.id !== songId),
  }));
  broadcast.broadcastQueue(venueCode, updated);
  res.json({ success: true });
});

// POST /api/queue/:venueCode/create-payment
router.post('/:venueCode/create-payment', async (req, res) => {
  const { venueCode } = req.params;
  const { song, deviceId, clientOrigin } = req.body;

  const venue = db.getVenue(venueCode);
  if (!venue) return res.status(404).json({ error: 'Venue not found' });
  if (!venue.settings?.requirePaymentForRequest) {
    return res.status(400).json({ error: 'This venue does not require payment for requests' });
  }

  const priceCents = venue.settings.requestPriceCents ?? 1000;
  if (priceCents < 500 || priceCents > 5000) {
    return res.status(400).json({ error: 'Invalid request price' });
  }

  const yocoSecret = process.env.YOCO_SECRET_KEY;
  if (!yocoSecret) {
    return res.status(503).json({ error: 'Payment integration not configured' });
  }

  // Validate clientOrigin to prevent open redirect — only allow same origin or PUBLIC_URL
  const allowedOrigins = [req.headers.origin, process.env.PUBLIC_URL].filter(Boolean);
  let baseUrl = process.env.PUBLIC_URL || req.headers.origin || 'http://localhost:5173';
  if (typeof clientOrigin === 'string' && clientOrigin) {
    try {
      const parsed = new URL(clientOrigin);
      if (allowedOrigins.some((o) => { try { return new URL(o).origin === parsed.origin; } catch { return false; } })) {
        baseUrl = clientOrigin;
      }
    } catch {} // invalid URL — use default
  }
  const base = baseUrl.replace(/\/$/, '');
  const successUrl = `${base}/v/${venueCode}/request-success`;
  const cancelUrl = `${base}/v/${venueCode}`;
  const failureUrl = cancelUrl;

  try {
    const response = await fetch('https://payments.yoco.com/api/checkouts', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${yocoSecret}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        amount: priceCents,
        currency: 'ZAR',
        successUrl,
        cancelUrl,
        failureUrl,
        metadata: { venueCode },
      }),
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      return res.status(response.status).json({ error: errData.message || 'Payment creation failed' });
    }
    const data = await response.json();

    const checkoutId = data.id;
    const redirectUrl = data.redirectUrl;
    if (!checkoutId || !redirectUrl) {
      return res.status(500).json({ error: 'Invalid response from payment provider' });
    }

    db.setPendingPayment(checkoutId, {
      venueCode,
      amountCents: priceCents,
      song: {
        id: song.id || `song_${song.appleId}`,
        appleId: song.appleId,
        title: song.title,
        artist: song.artist,
        albumArt: song.albumArt,
        duration: song.duration,
      },
      deviceId,
    });

    res.json({ redirectUrl, checkoutId });
  } catch (err) {
    console.error('Yoco checkout error:', err);
    res.status(500).json({ error: 'Could not create payment' });
  }
});

// GET /api/queue/:venueCode/request-status?checkoutId=xxx
router.get('/:venueCode/request-status', async (req, res) => {
  const { venueCode } = req.params;
  const { checkoutId } = req.query;
  if (!checkoutId) return res.status(400).json({ error: 'checkoutId required' });

  const pending = db.getPendingPayment(checkoutId);
  if (!pending) return res.json({ fulfilled: true });
  if (pending.venueCode !== venueCode) {
    return res.status(403).json({ error: 'Invalid checkout' });
  }

  const yocoSecret = process.env.YOCO_SECRET_KEY;
  if (yocoSecret) {
    try {
      const response = await fetch(
        `https://payments.yoco.com/api/checkouts/${checkoutId}`,
        { headers: { Authorization: `Bearer ${yocoSecret}` } }
      );
      if (response.ok) {
        const data = await response.json();
        const status = (data.status || '').toLowerCase();
        const hasPayment = !!(data.paymentId || data.payment?.id);
        const isComplete =
          status === 'completed' || status === 'succeeded' ||
          status === 'complete'  || status === 'success'  || hasPayment;
        if (isComplete) {
          const amountCents = data.amount ?? data.payment?.amount ?? pending.amountCents;
          if (await fulfillPaidRequest(checkoutId, amountCents)) {
            broadcast.broadcastQueue(venueCode, queueRepo.get(venueCode));
            return res.json({ fulfilled: true });
          }
        }
      }
    } catch (err) {
      console.warn('Yoco checkout status fetch failed:', err.message);
    }
  }

  res.json({ fulfilled: false });
});

// GET /api/queue/:venueCode/autofill
router.get('/:venueCode/autofill', async (req, res) => {
  const { venueCode } = req.params;
  const venue = db.getVenue(venueCode);
  if (!venue) return res.status(404).json({ error: 'Venue not found' });

  const preCheck = queueRepo.get(venueCode);
  if (preCheck.nowPlaying || (preCheck.upcoming && preCheck.upcoming.length > 0)) {
    return res.json({ filled: false, reason: 'Queue is not empty' });
  }

  try {
    const genreSetting = venue.settings?.autoplayGenre;
    const genres = Array.isArray(genreSetting) ? genreSetting : (genreSetting ? [genreSetting] : []);
    const autoplayMode = venue.settings?.autoplayMode || 'playlist';
    const playlists = venue.playlists || [];

    // Dayparting: check if a playlist is scheduled for the current hour
    let activePl = null;
    const schedule = venue.settings?.playlistSchedule;
    if (Array.isArray(schedule) && schedule.length > 0) {
      const now = new Date();
      const currentHour = now.getHours();
      const currentDay = now.getDay();
      const slot = schedule.find((s) => {
        const hourMatch = s.startHour <= s.endHour
          ? currentHour >= s.startHour && currentHour < s.endHour
          : currentHour >= s.startHour || currentHour < s.endHour;
        if (!hourMatch) return false;
        if (Array.isArray(s.days) && s.days.length > 0) return s.days.includes(currentDay);
        return true;
      });
      if (slot) activePl = playlists.find((p) => p.id === slot.playlistId);
    }
    if (!activePl) {
      activePl = playlists.find((p) => p.id === venue.activePlaylistId)
        || playlists.find((p) => p.songs?.length > 0);
    }
    const playlist = activePl?.songs || venue.playlist || [];

    let song = null;
    if (autoplayMode !== 'random' && playlist.length > 0) {
      song = pickFromPlaylist(playlist, venueCode);
    }
    if (!song) {
      song = await searchByGenre(genres, venueCode);
    }
    if (!song) {
      return res.json({ filled: false, reason: 'No songs found' });
    }

    const now = Date.now();
    const newSong = {
      ...song,
      id: song.id || `autofill_${now}`,
      votes: 0,
      requestedBy: '__autofill__',
      requestedAt: now,
    };

    const written = await queueRepo.update(venueCode, (queue) => {
      if (queue.nowPlaying || (queue.upcoming && queue.upcoming.length > 0)) return null;
      return {
        nowPlaying: { ...newSong, positionMs: 0, positionAnchoredAt: now, isPaused: false },
        upcoming: [],
      };
    });

    if (!written.nowPlaying) {
      return res.json({ filled: false, reason: 'Queue was filled by another request' });
    }

    logEvent({ venueCode, action: 'autofill', songId: newSong.id, detail: `"${newSong.title}" autofilled` });
    broadcast.broadcastQueue(venueCode, written);
    res.json({ filled: true, song: newSong });
  } catch (err) {
    console.error('Autofill error:', err);
    res.status(500).json({ error: 'Failed to autofill queue' });
  }
});

module.exports = router;
