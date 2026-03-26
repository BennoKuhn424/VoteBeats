const crypto = require('crypto');
const express = require('express');
const db = require('../utils/database');

const router = express.Router();

function adminAuth(req, res, next) {
  const key = req.headers['x-admin-key'];
  const secret = process.env.ADMIN_SECRET;
  if (!secret || key == null || key === '') {
    return res.status(403).json({ error: 'Unauthorized' });
  }
  const a = Buffer.from(String(key), 'utf8');
  const b = Buffer.from(String(secret), 'utf8');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return res.status(403).json({ error: 'Unauthorized' });
  }
  next();
}

// GET /api/admin/venue-earnings?year=2025&month=2 – all venues' earnings for the month
router.get('/venue-earnings', adminAuth, (req, res) => {
  const now = new Date();
  const year = parseInt(req.query.year, 10) || now.getFullYear();
  const month = parseInt(req.query.month, 10) || now.getMonth() + 1;

  const byVenue = db.getAllVenueEarningsForMonth(year, month);
  const venues = db.getAllVenues();
  const venueSharePercent = parseInt(process.env.VENUE_EARNINGS_PERCENT, 10) || 80;

  const result = Object.entries(byVenue).map(([venueCode, data]) => {
    const grossCents = data.grossCents || 0;
    const venueShareCents = Math.round(grossCents * (venueSharePercent / 100));
    const venue = venues[venueCode] || {};
    return {
      venueCode,
      venueName: venue.name || venueCode,
      grossRand: (grossCents / 100).toFixed(2),
      venueShareRand: (venueShareCents / 100).toFixed(2),
      paymentsCount: data.count || 0,
    };
  });

  res.json({ year, month, venues: result });
});

module.exports = router;
