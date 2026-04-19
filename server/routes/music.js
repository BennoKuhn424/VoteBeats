const express = require('express');
const { getProvider } = require('../providers');

const router = express.Router();

// GET /api/music/search?q=...&venueCode=...
router.get('/search', async (req, res) => {
  const { q, venueCode } = req.query;

  if (!q || !venueCode) {
    return res.status(400).json({ error: 'Query and venueCode required' });
  }

  try {
    const provider = getProvider();
    const results = await provider.search(q.trim(), venueCode);
    res.json(results);
  } catch (err) {
    console.error('Music search error:', err);
    res.status(500).json({ error: 'Search failed' });
  }
});

module.exports = router;
