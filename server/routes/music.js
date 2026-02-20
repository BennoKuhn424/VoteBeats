const express = require('express');
const { searchAppleMusic } = require('../utils/appleMusicAPI');

const router = express.Router();

// GET /api/music/search?q=...&venueCode=...
router.get('/search', async (req, res) => {
  const { q, venueCode } = req.query;

  if (!q || !venueCode) {
    return res.status(400).json({ error: 'Query and venueCode required' });
  }

  try {
    const results = await searchAppleMusic(q.trim(), venueCode);
    res.json(results);
  } catch (err) {
    console.error('Music search error:', err);
    res.status(500).json({ error: 'Search failed' });
  }
});

module.exports = router;
