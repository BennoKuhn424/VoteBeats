const express = require('express');
const db = require('../utils/database');
const { v4: uuidv4 } = require('uuid');
const authMiddleware = require('../middleware/authMiddleware');
const { advanceToNextSong } = require('../utils/queueAdvance');
const { fulfillPaidRequest } = require('../utils/paymentFulfill');
const { searchByGenre, pickFromPlaylist } = require('../utils/appleMusicAPI');
const broadcast = require('../utils/broadcast');

const router = express.Router();

// ── Anchor-pattern helper ─────────────────────────────────────────────────────
// Computes how many ms into the song we are right now.
// Works for both new anchor fields and the legacy startedAt field.
function getCurrentPositionMs(np) {
  if (!np) return 0;
  const posMs = np.positionMs ?? 0;
  const anchoredAt = np.positionAnchoredAt ?? np.startedAt ?? Date.now();
  if (np.isPaused || np.pausedAt) return posMs; // frozen when paused
  return posMs + (Date.now() - anchoredAt);
}

// ── Server-side autofill ──────────────────────────────────────────────────────
const pendingAutofillVenues = new Set();

async function serverAutofill(venueCode, venue) {
  if (pendingAutofillVenues.has(venueCode)) return;
  pendingAutofillVenues.add(venueCode);
  try {
    const currentQueue = db.getQueue(venueCode);
    if (currentQueue.nowPlaying || (currentQueue.upcoming && currentQueue.upcoming.length > 0)) return;

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
      song = await searchByGenre(genres, venueCode);
    }
    if (!song) return;

    const now = Date.now();
    db.updateQueue(venueCode, {
      nowPlaying: {
        ...song,
        id: song.id || `autofill_${now}`,
        votes: 0,
        requestedBy: '__autofill__',
        requestedAt: now,
        positionMs: 0,
        positionAnchoredAt: now,
        isPaused: false,
      },
      upcoming: [],
    });
    broadcast.broadcastQueue(venueCode, db.getQueue(venueCode));
  } finally {
    pendingAutofillVenues.delete(venueCode);
  }
}

// GET /api/queue/:venueCode?deviceId=xxx
router.get('/:venueCode', (req, res) => {
  const { venueCode } = req.params;
  const { deviceId } = req.query;
  let queue = db.getQueue(venueCode);
  const venue = db.getVenue(venueCode);

  // Auto-advance based on anchor position so any page poll can trigger it
  const np = queue.nowPlaying;
  if (np && !np.isPaused && !np.pausedAt) {
    const duration = np.duration || 180;
    let durationMs = duration * 1000;
    if (durationMs < 60000) durationMs = 180000;
    const currentPos = getCurrentPositionMs(np) + 5000; // 5s grace
    if (currentPos >= durationMs) {
      advanceToNextSong(venueCode, np.id);
      queue = db.getQueue(venueCode);
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
router.post('/:venueCode/request', (req, res) => {
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

  const queue = db.getQueue(venueCode);
  const upcoming = queue.upcoming || [];
  const userSongs = upcoming.filter((s) => s.requestedBy === deviceId);

  const songId = song.id || song.appleId;
  const alreadyInQueue = upcoming.some(
    (s) => (s.id && s.id === songId) || (s.appleId && s.appleId === song.appleId)
  );
  if (alreadyInQueue) {
    return res.status(400).json({ error: 'This song is already in the queue' });
  }

  if (userSongs.length >= (venue.settings?.maxSongsPerUser ?? 3)) {
    return res.status(400).json({
      error: `Max ${venue.settings.maxSongsPerUser} songs per user`,
    });
  }

  const newSong = {
    ...song,
    id: song.id || `song_${uuidv4()}`,
    votes: 0,
    requestedBy: deviceId,
    requestedAt: Date.now(),
  };

  const updatedQueue = {
    nowPlaying: queue.nowPlaying,
    upcoming: [...(queue.upcoming || []), newSong],
  };
  try {
    db.updateQueue(venueCode, updatedQueue);
  } catch (err) {
    console.error('Queue write error on /request:', err);
    return res.status(500).json({ error: 'Could not add song to queue — please try again' });
  }
  broadcast.broadcastQueue(venueCode, db.getQueue(venueCode));

  res.json({ success: true, song: newSong });
});

// POST /api/queue/:venueCode/vote
router.post('/:venueCode/vote', (req, res) => {
  const { venueCode } = req.params;
  const { songId, voteValue, deviceId } = req.body;

  if (voteValue !== 1 && voteValue !== -1) {
    return res.status(400).json({ error: 'Invalid vote value' });
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

  const queue = db.getQueue(venueCode);
  const song =
    (queue.upcoming || []).find((s) => s.id === songId) ||
    (queue.nowPlaying?.id === songId ? queue.nowPlaying : null);

  if (!song) {
    // Song was removed from queue after vote was written — clean up the stray entry
    db.removeVote(venueCode, songId, deviceId);
    return res.status(404).json({ error: 'Song is no longer in the queue' });
  }

  song.votes = (song.votes || 0) + voteDelta;
  db.updateQueue(venueCode, queue);
  broadcast.broadcastQueue(venueCode, db.getQueue(venueCode));

  res.json({
    success: true,
    newVoteCount: song.votes,
    myVote: existingVote === voteValue ? null : voteValue,
  });
});

// POST /api/queue/:venueCode/playing
// Venue player reports playback started or resumed.
// positionSeconds (optional): current playback position so the anchor is accurate on resume/rewind.
router.post('/:venueCode/playing', (req, res) => {
  const { venueCode } = req.params;
  const { songId, positionSeconds } = req.body;

  const queue = db.getQueue(venueCode);
  if (!queue.nowPlaying || (queue.nowPlaying.id !== songId && String(queue.nowPlaying.appleId) !== String(songId))) {
    return res.json({ success: true, matched: false });
  }

  const pos = typeof positionSeconds === 'number' && positionSeconds > 0 ? positionSeconds : 0;
  queue.nowPlaying.positionMs = Math.round(pos * 1000);
  queue.nowPlaying.positionAnchoredAt = Date.now();
  queue.nowPlaying.isPaused = false;
  // Clean up legacy fields
  delete queue.nowPlaying.startedAt;
  delete queue.nowPlaying.pausedAt;

  db.updateQueue(venueCode, queue);
  broadcast.broadcastQueue(venueCode, db.getQueue(venueCode));
  res.json({ success: true, matched: true });
});

// POST /api/queue/:venueCode/pause
// Venue player reports playback paused — freezes the anchor so the timer stops.
router.post('/:venueCode/pause', (req, res) => {
  const { venueCode } = req.params;
  const { songId } = req.body;

  const queue = db.getQueue(venueCode);
  if (!queue.nowPlaying || (queue.nowPlaying.id !== songId && String(queue.nowPlaying.appleId) !== String(songId))) {
    return res.json({ success: true, matched: false });
  }

  // Freeze position at the current computed value
  queue.nowPlaying.positionMs = getCurrentPositionMs(queue.nowPlaying);
  queue.nowPlaying.positionAnchoredAt = Date.now();
  queue.nowPlaying.isPaused = true;
  delete queue.nowPlaying.startedAt;
  delete queue.nowPlaying.pausedAt;

  db.updateQueue(venueCode, queue);
  broadcast.broadcastQueue(venueCode, db.getQueue(venueCode));
  res.json({ success: true, matched: true });
});

// POST /api/queue/:venueCode/advance - MusicKit reports song ended
// Body may include songId to guard against double-advance races.
// Returns nowPlaying so the client can start playing immediately without
// a follow-up GET /queue or GET /autofill round-trip.
router.post('/:venueCode/advance', async (req, res) => {
  const { venueCode } = req.params;
  const { songId } = req.body;

  // Snapshot the expected song ID before any async work so that even if
  // a /skip request starts while we await serverAutofill below, the
  // advanceToNextSong guard uses the value we committed to at entry time.
  const expectedId = songId || db.getQueue(venueCode).nowPlaying?.id;
  advanceToNextSong(venueCode, expectedId);
  let queue = db.getQueue(venueCode);

  // If queue is now empty and autoplay is on, fill it synchronously so the
  // client gets a nowPlaying in the same response — no extra round-trips.
  if (!queue.nowPlaying && (!queue.upcoming || queue.upcoming.length === 0)) {
    const venue = db.getVenue(venueCode);
    const s = venue?.settings;
    if (s?.autoplayMode !== 'off' && s?.autoplayQueue !== false) {
      await serverAutofill(venueCode, venue).catch(() => {});
      queue = db.getQueue(venueCode);
    }
  }

  // Single broadcast with the final state (avoids a transient empty-queue push)
  broadcast.broadcastQueue(venueCode, queue);
  res.json({ success: true, nowPlaying: queue.nowPlaying || null });
});

// POST /api/queue/:venueCode/skip (venue owner only)
// Accepts optional songId so the expectedSongId guard in advanceToNextSong
// prevents a double-advance when /skip and a song-end /advance race.
router.post('/:venueCode/skip', authMiddleware, (req, res) => {
  if (req.venue.code !== req.params.venueCode) {
    return res.status(403).json({ error: 'Unauthorized' });
  }
  const { songId } = req.body;
  if (!songId) {
    return res.status(400).json({ error: 'songId required for skip' });
  }
  // Verify the song the client wants to skip is still the active one.
  // If it no longer matches (concurrent /advance already ran), treat as no-op
  // so two racing callers can never skip two songs.
  const currentSongId = db.getQueue(req.params.venueCode).nowPlaying?.id;
  if (currentSongId && currentSongId !== songId) {
    return res.status(409).json({ error: 'Skip rejected — song already changed', currentSongId });
  }
  advanceToNextSong(req.params.venueCode, songId);
  broadcast.broadcastQueue(req.params.venueCode, db.getQueue(req.params.venueCode));
  res.json({ success: true });
});

// DELETE /api/queue/:venueCode/song/:songId (venue owner only)
router.delete('/:venueCode/song/:songId', authMiddleware, (req, res) => {
  const { venueCode, songId } = req.params;

  if (req.venue.code !== venueCode) {
    return res.status(403).json({ error: 'Unauthorized' });
  }

  const queue = db.getQueue(venueCode);
  queue.upcoming = (queue.upcoming || []).filter((s) => s.id !== songId);
  db.updateQueue(venueCode, queue);
  broadcast.broadcastQueue(venueCode, db.getQueue(venueCode));

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

  let pending = db.getPendingPayment(checkoutId);
  if (!pending) {
    return res.json({ fulfilled: true });
  }
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
        // Use exact terminal-status matches only — loose includes() could match
        // transitional statuses like "completion_pending" and mark unpaid orders paid.
        const isComplete =
          status === 'completed' ||
          status === 'succeeded' ||
          status === 'complete' ||
          status === 'success' ||
          hasPayment;
        if (isComplete) {
          const amountCents = data.amount ?? data.payment?.amount ?? pending.amountCents;
          if (fulfillPaidRequest(checkoutId, amountCents)) {
            broadcast.broadcastQueue(venueCode, db.getQueue(venueCode));
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

  const genreSetting = venue.settings?.autoplayGenre;
  const genres = Array.isArray(genreSetting) ? genreSetting : (genreSetting ? [genreSetting] : []);

  const queue = db.getQueue(venueCode);
  if (queue.nowPlaying || (queue.upcoming && queue.upcoming.length > 0)) {
    return res.json({ filled: false, reason: 'Queue is not empty' });
  }

  try {
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

    const updatedQueue = {
      nowPlaying: { ...newSong, positionMs: 0, positionAnchoredAt: now, isPaused: false },
      upcoming: [],
    };
    db.updateQueue(venueCode, updatedQueue);
    broadcast.broadcastQueue(venueCode, db.getQueue(venueCode));

    res.json({ filled: true, song: newSong });
  } catch (err) {
    console.error('Autofill error:', err);
    res.status(500).json({ error: 'Failed to autofill queue' });
  }
});

module.exports = router;
