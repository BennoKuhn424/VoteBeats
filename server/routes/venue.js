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

// POST /api/venue/:venueCode/playlist/generate-checkout – create R50 Yoco checkout to generate AI playlist
router.post('/:venueCode/playlist/generate-checkout', authMiddleware, async (req, res) => {
  if (req.venue.code !== req.params.venueCode) return res.status(403).json({ error: 'Unauthorized' });

  const { prompt } = req.body;
  if (!prompt?.trim()) return res.status(400).json({ error: 'Prompt is required' });

  const yocoSecret = process.env.YOCO_SECRET_KEY;
  if (!yocoSecret) return res.status(503).json({ error: 'Payment not configured' });

  const venueCode = req.params.venueCode;
  const base = (req.headers.origin || process.env.PUBLIC_URL || 'http://localhost:5173').replace(/\/$/, '');
  const successUrl = `${base}/venue/player/${venueCode}?generatePlaylist=1`;
  const cancelUrl = `${base}/venue/player/${venueCode}`;

  try {
    const response = await fetch('https://payments.yoco.com/api/checkouts', {
      method: 'POST',
      headers: { Authorization: `Bearer ${yocoSecret}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        amount: 5000,
        currency: 'ZAR',
        successUrl,
        cancelUrl,
        failureUrl: cancelUrl,
        metadata: { venueCode },
      }),
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      return res.status(response.status).json({ error: err.message || 'Payment creation failed' });
    }
    const data = await response.json();
    const { id: checkoutId, redirectUrl } = data;
    if (!checkoutId || !redirectUrl) return res.status(500).json({ error: 'Invalid payment response' });

    db.setPendingPayment(checkoutId, { venueCode, amountCents: 5000, prompt: prompt.trim() });
    res.json({ redirectUrl, checkoutId });
  } catch (err) {
    console.error('Generate checkout error:', err);
    res.status(500).json({ error: 'Could not create payment' });
  }
});

// POST /api/venue/:venueCode/playlist/generate – verify payment, call Claude, add songs to playlist
router.post('/:venueCode/playlist/generate', authMiddleware, async (req, res) => {
  if (req.venue.code !== req.params.venueCode) return res.status(403).json({ error: 'Unauthorized' });

  const { checkoutId, prompt: bodyPrompt } = req.body;
  if (!checkoutId) return res.status(400).json({ error: 'checkoutId required' });

  const pending = db.getPendingPayment(checkoutId);

  // If pending payment is missing (e.g. server restarted), fall back to Yoco-only verification
  // with the prompt provided by the client (saved in localStorage before redirect)
  let resolvedPrompt;
  if (!pending) {
    if (!bodyPrompt?.trim()) {
      return res.status(404).json({ error: 'Payment not found. Please try again.' });
    }
    // Verify with Yoco directly
    const yocoSecret = process.env.YOCO_SECRET_KEY;
    if (!yocoSecret) return res.status(404).json({ error: 'Payment not found. Please try again.' });
    try {
      const yocoRes = await fetch(`https://payments.yoco.com/api/checkouts/${checkoutId}`, {
        headers: { Authorization: `Bearer ${yocoSecret}` },
      });
      if (!yocoRes.ok) return res.status(402).json({ error: 'Payment could not be verified. Please try again.' });
      const d = await yocoRes.json();
      const status = (d.status || '').toLowerCase();
      const paid = status === 'completed' || status === 'succeeded' || status.includes('complete') || !!(d.paymentId || d.payment?.id);
      if (!paid) return res.status(402).json({ error: 'Payment not completed yet.' });
    } catch (err) {
      console.warn('Yoco verify fallback failed:', err.message);
      return res.status(402).json({ error: 'Payment could not be verified. Please try again.' });
    }
    resolvedPrompt = bodyPrompt.trim();
  } else {
    if (pending.venueCode !== req.params.venueCode) return res.status(403).json({ error: 'Invalid checkout' });
    // Verify with Yoco
    const yocoSecret = process.env.YOCO_SECRET_KEY;
    if (yocoSecret) {
      try {
        const yocoRes = await fetch(`https://payments.yoco.com/api/checkouts/${checkoutId}`, {
          headers: { Authorization: `Bearer ${yocoSecret}` },
        });
        if (yocoRes.ok) {
          const d = await yocoRes.json();
          const status = (d.status || '').toLowerCase();
          const paid = status === 'completed' || status === 'succeeded' || status.includes('complete') || !!(d.paymentId || d.payment?.id);
          if (!paid) return res.status(402).json({ error: 'Payment not completed yet' });
        }
      } catch (err) { console.warn('Yoco verify failed:', err.message); }
    }
    db.removePendingPayment(checkoutId);
    resolvedPrompt = pending.prompt;
  }

  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicKey) return res.status(503).json({ error: 'AI generation not configured. Set ANTHROPIC_API_KEY.' });

  try {
    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': anthropicKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1024,
        system: 'You are a music curator for a venue. Given a vibe/style description, return 25 well-known popular songs that match. Return ONLY valid JSON: {"songs":[{"title":"Song Title","artist":"Artist Name"}]}. No markdown. Only songs available on major streaming platforms.',
        messages: [{ role: 'user', content: `Generate a playlist for this vibe: ${resolvedPrompt}` }],
      }),
    });
    if (!claudeRes.ok) throw new Error(`Claude API error: ${claudeRes.status}`);

    const claudeData = await claudeRes.json();
    let text = (claudeData?.content?.[0]?.text || '').trim();
    if (text.startsWith('```')) text = text.replace(/^```json?\n?/, '').replace(/\n?```$/, '');

    let suggestions = [];
    try { suggestions = JSON.parse(text).songs; } catch {
      const m = text.match(/\{[\s\S]*\}/);
      if (m) try { suggestions = JSON.parse(m[0]).songs; } catch {}
    }
    if (!Array.isArray(suggestions) || suggestions.length === 0) {
      return res.status(500).json({ error: 'AI returned no song suggestions' });
    }

    const { searchAppleMusic } = require('../utils/appleMusicAPI');
    const venue = db.getVenue(req.params.venueCode);
    if (!Array.isArray(venue.playlist)) venue.playlist = [];
    const existingIds = new Set(venue.playlist.map((s) => s.appleId));
    const added = [];

    // Search Apple Music in parallel batches of 5
    for (let i = 0; i < suggestions.length; i += 5) {
      const batch = suggestions.slice(i, i + 5);
      const results = await Promise.all(batch.map(async ({ title, artist }) => {
        try {
          const songs = await searchAppleMusic(`${title} ${artist}`);
          const match = songs[0];
          return (match && !existingIds.has(match.appleId)) ? match : null;
        } catch { return null; }
      }));
      for (const song of results) {
        if (!song || venue.playlist.length >= 500) continue;
        const entry = { id: `pl_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, appleId: song.appleId, title: song.title, artist: song.artist, albumArt: song.albumArt, duration: song.duration };
        venue.playlist.push(entry);
        existingIds.add(song.appleId);
        added.push(entry);
      }
    }

    db.saveVenue(venue.code, venue);
    res.json({ added, total: venue.playlist.length });
  } catch (err) {
    console.error('Generate playlist error:', err);
    res.status(500).json({ error: 'Failed to generate playlist' });
  }
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
