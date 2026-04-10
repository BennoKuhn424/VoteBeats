const express = require('express');

const router = express.Router();

// GET /api/lyrics?title=X&artist=Y&duration=Z
// Proxies to LRCLIB.net — free, no API key, returns timestamped (karaoke) lyrics.
router.get('/', async (req, res) => {
  const { title, artist, duration } = req.query;
  if (!title || !artist) {
    return res.status(400).json({ error: 'title and artist are required' });
  }
  if (title.length > 500 || artist.length > 500) {
    return res.status(400).json({ error: 'title or artist too long' });
  }

  try {
    // Try exact match first (faster, includes duration for better accuracy)
    const exactParams = new URLSearchParams({ track_name: title, artist_name: artist });
    if (duration) exactParams.set('duration', String(Math.round(Number(duration))));

    const exactRes = await fetch(`https://lrclib.net/api/get?${exactParams}`, {
      headers: { 'User-Agent': 'Speeldit/1.0 (https://github.com/speeldit)' },
    });

    if (exactRes.ok) {
      const data = await exactRes.json();
      return res.json({
        syncedLyrics: data.syncedLyrics || null,
        plainLyrics: data.plainLyrics || null,
      });
    }

    // Fall back to search (handles slight title/artist name mismatches)
    const searchParams = new URLSearchParams({ track_name: title, artist_name: artist });
    const searchRes = await fetch(`https://lrclib.net/api/search?${searchParams}`, {
      headers: { 'User-Agent': 'Speeldit/1.0 (https://github.com/speeldit)' },
    });

    if (searchRes.ok) {
      const results = await searchRes.json();
      if (Array.isArray(results) && results.length > 0) {
        // Prefer results that have synced lyrics
        const withSynced = results.find((r) => r.syncedLyrics);
        const best = withSynced || results[0];
        return res.json({
          syncedLyrics: best.syncedLyrics || null,
          plainLyrics: best.plainLyrics || null,
        });
      }
    }

    // Nothing found
    res.json({ syncedLyrics: null, plainLyrics: null });
  } catch (err) {
    console.error('Lyrics fetch error:', err);
    res.json({ syncedLyrics: null, plainLyrics: null });
  }
});

module.exports = router;
