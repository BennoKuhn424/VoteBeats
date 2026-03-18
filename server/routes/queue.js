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
    const activePl = playlists.find((p) => p.id === venue?.activePlaylistId)
      || playlists.find((p) => p.songs?.length > 0);
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

  // Auto-advance based on anchor position so any page poll can trigger it
  const np = queue.nowPlaying;
  if (np && !np.isPaused && !np.pausedAt) {
    const duration = np.duration || 180;
    let durationMs = duration * 1000;
    if (durationMs < 60000) durationMs = 180000;
    const currentPos = getCurrentPositionMs(np) + 5000; // 5s grace
    if (currentPos >= durationMs) {
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

  // Pre-check outside the lock for fast error responses
  const currentQueue = queueRepo.get(venueCode);
  const upcoming = currentQueue.upcoming || [];
  const songId = song.id || song.appleId;
  const alreadyInQueue = upcoming.some(
    (s) => (s.id && s.id === songId) || (s.appleId && s.appleId === song.appleId)
  );
  if (alreadyInQueue) {
    return res.status(400).json({ error: 'This song is already in the queue' });
  }
  if (upcoming.filter((s) => s.requestedBy === deviceId).length >= (venue.settings?.maxSongsPerUser ?? 3)) {
    return res.status(400).json({ error: `Max ${venue.settings?.maxSongsPerUser ?? 3} songs per user` });
  }

  const newSong = {
    ...song,
    id: song.id || `song_${uuidv4()}`,
    votes: 0,
    requestedBy: deviceId,
    requestedAt: Date.now(),
  };

  try {
    const updated = await queueRepo.update(venueCode, (queue) => ({
      nowPlaying: queue.nowPlaying,
      upcoming: [...(queue.upcoming || []), newSong],
    }));
    logEvent({ venueCode, action: 'request', songId: newSong.id, detail: `"${newSong.title}" added to queue` });
    broadcast.broadcastQueue(venueCode, updated);
    res.json({ success: true, song: newSong });
  } catch (err) {
    console.error('Queue write error on /request:', err);
    res.status(500).json({ error: 'Could not add song to queue — please try again' });
  }
});

// POST /api/queue/:venueCode/vote
router.post('/:venueCode/vote', async (req, res) => {
  const { venueCode } = req.params;
  const { songId, voteValue, deviceId } = req.body;

  if (voteValue !== 1 && voteValue !== -1) {
    return res.status(400).json({ error: 'Invalid vote value' });
  }

  // Compute vote delta from the votes table (separate from queue)
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

  // Check that the song still exists before applying the delta
  const snapshot = queueRepo.get(venueCode);
  const targetSong =
    (snapshot.upcoming || []).find((s) => s.id === songId) ||
    (snapshot.nowPlaying?.id === songId ? snapshot.nowPlaying : null);

  if (!targetSong) {
    db.removeVote(venueCode, songId, deviceId);
    return res.status(404).json({ error: 'Song is no longer in the queue' });
  }

  const newVoteCount = (targetSong.votes || 0) + voteDelta;

  const updated = await queueRepo.update(venueCode, (queue) => {
    const updateVotes = (s) =>
      s.id === songId ? { ...s, votes: (s.votes || 0) + voteDelta } : s;
    return {
      nowPlaying: queue.nowPlaying?.id === songId
        ? { ...queue.nowPlaying, votes: (queue.nowPlaying.votes || 0) + voteDelta }
        : queue.nowPlaying,
      upcoming: (queue.upcoming || []).map(updateVotes),
    };
  });

  logEvent({ venueCode, action: 'vote', songId, detail: `delta=${voteDelta}` });
  broadcast.broadcastQueue(venueCode, updated);

  res.json({
    success: true,
    newVoteCount,
    myVote: existingVote === voteValue ? null : voteValue,
  });
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

  const baseUrl =
    (typeof clientOrigin === 'string' && clientOrigin) ||
    req.headers.origin ||
    process.env.PUBLIC_URL ||
    'http://localhost:5173';
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
    const activePl = playlists.find((p) => p.id === venue.activePlaylistId)
      || playlists.find((p) => p.songs?.length > 0);
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
