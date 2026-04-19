const express = require('express');
const { getProvider } = require('../providers');
const E = require('../utils/errorCodes');

const router = express.Router();

/**
 * GET /api/search?q=songname&venueCode=xxx
 * venueCode optional - used for venue-specific filtering (explicit, genre, blocked artists)
 * Returns: { results: [{ trackName, artistName, artwork, songId }] }
 */
router.get('/', async (req, res) => {
  const { q, venueCode } = req.query;

  if (!q || typeof q !== 'string') {
    return res.status(400).json({ error: 'Query parameter q is required', code: E.SEARCH_QUERY_REQUIRED });
  }

  try {
    const provider = getProvider();
    const songs = await provider.search(q.trim(), venueCode || null);

    // Map to user-requested format: trackName, artistName, artwork (300x300), songId
    const results = songs.map((s) => ({
      trackName: s.title,
      artistName: s.artist,
      artwork: s.albumArt || '',
      songId: s.providerTrackId || s.appleId,
      duration: s.duration,
      genre: s.genre,
    }));

    res.json({ results });
  } catch (err) {
    console.error('Search error:', err);
    res.status(500).json({ error: 'Search failed', code: E.SEARCH_FAILED });
  }
});

module.exports = router;
