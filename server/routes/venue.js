const express = require('express');
const db = require('../utils/database');
const authMiddleware = require('../middleware/authMiddleware');

const router = express.Router();

// GET /api/venue/:venueCode (requires auth)
router.get('/:venueCode', authMiddleware, (req, res) => {
  if (req.venue.code !== req.params.venueCode) {
    return res.status(403).json({ error: 'Unauthorized' });
  }

  const venue = { ...req.venue };
  delete venue.owner;
  res.json(venue);
});

// PUT /api/venue/:venueCode/settings
router.put('/:venueCode/settings', authMiddleware, (req, res) => {
  if (req.venue.code !== req.params.venueCode) {
    return res.status(403).json({ error: 'Unauthorized' });
  }

  const { allowExplicit, maxSongsPerUser, genreFilters, blockedArtists, requirePaymentForRequest, requestPriceCents, autoplayQueue, autoplayMode } = req.body;
  const venue = db.getVenue(req.params.venueCode);
  if (!venue.settings) venue.settings = {};

  if (typeof allowExplicit === 'boolean') venue.settings.allowExplicit = allowExplicit;
  if (typeof maxSongsPerUser === 'number') venue.settings.maxSongsPerUser = maxSongsPerUser;
  if (Array.isArray(genreFilters)) venue.settings.genreFilters = genreFilters;
  if (Array.isArray(blockedArtists)) venue.settings.blockedArtists = blockedArtists;
  if (typeof requirePaymentForRequest === 'boolean') venue.settings.requirePaymentForRequest = requirePaymentForRequest;
  if (typeof requestPriceCents === 'number' && requestPriceCents >= 500 && requestPriceCents <= 5000) {
    venue.settings.requestPriceCents = requestPriceCents;
  }
  if (typeof autoplayQueue === 'boolean') venue.settings.autoplayQueue = autoplayQueue;
  if (typeof autoplayMode === 'string' && ['off', 'playlist', 'random'].includes(autoplayMode)) {
    venue.settings.autoplayMode = autoplayMode;
  }
  if (req.body.autoplayGenre !== undefined) {
    const ag = req.body.autoplayGenre;
    if (Array.isArray(ag) && ag.length > 0) {
      venue.settings.autoplayGenre = ag;
    } else if (typeof ag === 'string' && ag) {
      venue.settings.autoplayGenre = [ag];
    } else {
      venue.settings.autoplayGenre = null;
    }
  }

  db.saveVenue(venue.code, venue);
  res.json(venue.settings);
});

// POST /api/venue/:venueCode/playlist/add – add a song to the venue playlist
router.post('/:venueCode/playlist/add', authMiddleware, (req, res) => {
  if (req.venue.code !== req.params.venueCode) {
    return res.status(403).json({ error: 'Unauthorized' });
  }

  const { id, appleId, title, artist, albumArt, duration } = req.body;
  if (!appleId || !title) {
    return res.status(400).json({ error: 'appleId and title are required' });
  }

  const venue = db.getVenue(req.params.venueCode);
  if (!Array.isArray(venue.playlist)) venue.playlist = [];

  // Dedupe by appleId
  if (!venue.playlist.some((s) => s.appleId === appleId)) {
    if (venue.playlist.length >= 500) {
      return res.status(400).json({ error: 'Playlist limit reached (500 songs)' });
    }
    venue.playlist.push({ id: id || `pl_${Date.now()}`, appleId, title, artist, albumArt, duration });
    db.saveVenue(venue.code, venue);
  }

  res.json({ playlist: venue.playlist });
});

// DELETE /api/venue/:venueCode/playlist/:appleId – remove a song from the playlist
router.delete('/:venueCode/playlist/:appleId', authMiddleware, (req, res) => {
  if (req.venue.code !== req.params.venueCode) {
    return res.status(403).json({ error: 'Unauthorized' });
  }

  const venue = db.getVenue(req.params.venueCode);
  venue.playlist = (venue.playlist || []).filter((s) => s.appleId !== req.params.appleId);
  db.saveVenue(venue.code, venue);

  res.json({ playlist: venue.playlist });
});

// GET /api/venue/:venueCode/earnings – monthly pay-to-play earnings (auth required)
router.get('/:venueCode/earnings', authMiddleware, (req, res) => {
  if (req.venue.code !== req.params.venueCode) {
    return res.status(403).json({ error: 'Unauthorized' });
  }

  const now = new Date();
  const year = parseInt(req.query.year, 10) || now.getFullYear();
  const month = parseInt(req.query.month, 10) || now.getMonth() + 1;

  const { grossCents, count } = db.getVenueEarningsForMonth(req.params.venueCode, year, month);
  const venueSharePercent = parseInt(process.env.VENUE_EARNINGS_PERCENT, 10) || 80;
  const venueShareCents = Math.round(grossCents * (venueSharePercent / 100));
  const platformShareCents = grossCents - venueShareCents;

  res.json({
    year,
    month,
    grossCents,
    grossRand: (grossCents / 100).toFixed(2),
    venueShareCents,
    venueShareRand: (venueShareCents / 100).toFixed(2),
    platformShareCents,
    platformShareRand: (platformShareCents / 100).toFixed(2),
    paymentsCount: count,
  });
});

module.exports = router;
