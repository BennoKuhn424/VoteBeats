const express = require('express');
const db = require('../utils/database');
const { v4: uuidv4 } = require('uuid');
const authMiddleware = require('../middleware/authMiddleware');
const { advanceToNextSong } = require('../utils/queueAdvance');
const { fulfillPaidRequest } = require('../utils/paymentFulfill');
const { searchByGenre } = require('../utils/appleMusicAPI');

const router = express.Router();

// GET /api/queue/:venueCode?deviceId=xxx (deviceId optional – returns myVotes for this device when provided)
router.get('/:venueCode', (req, res) => {
  const { venueCode } = req.params;
  const { deviceId } = req.query;
  const queue = db.getQueue(venueCode);
  const venue = db.getVenue(venueCode);

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

  // Prevent duplicate: same song (by id or appleId) already in queue
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
  db.updateQueue(venueCode, updatedQueue);

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
  // Vote applies to both nowPlaying and upcoming
  const song =
    (queue.upcoming || []).find((s) => s.id === songId) ||
    (queue.nowPlaying?.id === songId ? queue.nowPlaying : null);

  if (song) {
    song.votes = (song.votes || 0) + voteDelta;
    db.updateQueue(venueCode, queue);
  }

  res.json({
    success: true,
    newVoteCount: song ? song.votes : 0,
    myVote: existingVote === voteValue ? null : voteValue,
  });
});

// POST /api/queue/:venueCode/playing - Venue player reports playback start (updates startedAt for accurate auto-advance)
router.post('/:venueCode/playing', (req, res) => {
  const { venueCode } = req.params;
  const { songId } = req.body;

  const queue = db.getQueue(venueCode);
  if (!queue.nowPlaying || (queue.nowPlaying.id !== songId && String(queue.nowPlaying.appleId) !== String(songId))) {
    return res.json({ success: true, matched: false });
  }

  queue.nowPlaying.startedAt = Date.now();
  db.updateQueue(venueCode, queue);
  res.json({ success: true, matched: true });
});

// POST /api/queue/:venueCode/advance - Venue player reports song ended (MusicKit completed)
router.post('/:venueCode/advance', (req, res) => {
  const { venueCode } = req.params;
  const queue = db.getQueue(venueCode);
  // #region agent log
  console.warn('[VB_DEBUG_SERVER] advance called', { venueCode, nowPlaying: queue.nowPlaying?.appleId, upcomingCount: (queue.upcoming||[]).length, stack: new Error().stack?.split('\n').slice(0,3).join(' | ') });
  // #endregion
  if (!queue.nowPlaying && (!queue.upcoming || queue.upcoming.length === 0)) {
    return res.json({ success: true });
  }
  advanceToNextSong(venueCode);
  res.json({ success: true });
});

// POST /api/queue/:venueCode/skip (venue owner only)
router.post('/:venueCode/skip', authMiddleware, (req, res) => {
  if (req.venue.code !== req.params.venueCode) {
    return res.status(403).json({ error: 'Unauthorized' });
  }
  advanceToNextSong(req.params.venueCode);
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

  res.json({ success: true });
});

// POST /api/queue/:venueCode/create-payment – create Yoco checkout for paid song request
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

  // Use client's origin so redirect lands on same origin as storage (sessionStorage/localStorage)
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

    const data = await response.json();
    if (!response.ok) {
      return res.status(response.status).json({ error: data.message || 'Payment creation failed' });
    }

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

// GET /api/queue/:venueCode/request-status?checkoutId=xxx – check if paid request was fulfilled
// Polls Yoco for payment status when webhook hasn't fired (e.g. localhost where Yoco can't reach webhook)
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

  // Webhook may not reach localhost/private IP – poll Yoco for payment status
  const yocoSecret = process.env.YOCO_SECRET_KEY;
  if (yocoSecret) {
    try {
      const response = await fetch(
        `https://payments.yoco.com/api/checkouts/${checkoutId}`,
        {
          headers: { Authorization: `Bearer ${yocoSecret}` },
        }
      );
      if (response.ok) {
        const data = await response.json();
        const status = (data.status || '').toLowerCase();
        const hasPayment = !!(data.paymentId || data.payment?.id);
        const isComplete =
          status === 'completed' ||
          status === 'succeeded' ||
          status.includes('complete') ||
          status.includes('succeed') ||
          hasPayment;
        if (isComplete) {
          const amountCents = data.amount ?? data.payment?.amount ?? pending.amountCents;
          if (fulfillPaidRequest(checkoutId, amountCents)) {
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

// GET /api/queue/:venueCode/autofill – get a random song from the venue's autoplay genre
router.get('/:venueCode/autofill', async (req, res) => {
  const { venueCode } = req.params;
  const venue = db.getVenue(venueCode);
  if (!venue) return res.status(404).json({ error: 'Venue not found' });

  const genreSetting = venue.settings?.autoplayGenre;
  const genres = Array.isArray(genreSetting) ? genreSetting : (genreSetting ? [genreSetting] : []);
  if (genres.length === 0) {
    return res.status(400).json({ error: 'No autoplay genre configured' });
  }
  const genre = genres[Math.floor(Math.random() * genres.length)];

  const queue = db.getQueue(venueCode);
  if (queue.nowPlaying || (queue.upcoming && queue.upcoming.length > 0)) {
    return res.json({ filled: false, reason: 'Queue is not empty' });
  }

  try {
    const song = await searchByGenre(genre, venueCode);
    if (!song) {
      return res.status(404).json({ error: 'No songs found for genre' });
    }

    const newSong = {
      ...song,
      id: song.id || `autofill_${Date.now()}`,
      votes: 0,
      requestedBy: '__autofill__',
      requestedAt: Date.now(),
    };

    const updatedQueue = {
      nowPlaying: newSong,
      upcoming: [],
    };
    db.updateQueue(venueCode, updatedQueue);

    res.json({ filled: true, song: newSong });
  } catch (err) {
    console.error('Autofill error:', err);
    res.status(500).json({ error: 'Failed to autofill queue' });
  }
});

module.exports = router;
