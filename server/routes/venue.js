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

  const { allowExplicit, maxSongsPerUser, genreFilters, blockedArtists, requirePaymentForRequest, requestPriceCents, autoplayQueue } = req.body;
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

  db.saveVenue(venue.code, venue);
  res.json(venue.settings);
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
