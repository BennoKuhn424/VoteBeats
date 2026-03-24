const express = require('express');
const db = require('../utils/database');
const venueRepo = require('../repos/venueRepo');
const authMiddleware = require('../middleware/authMiddleware');

const router = express.Router();

// ── Migrate single-playlist venues to multi-playlist format ──────────────────
function normalizePlaylists(venue) {
  if (!Array.isArray(venue.playlists)) {
    venue.playlists = [];
    if (Array.isArray(venue.playlist) && venue.playlist.length > 0) {
      venue.playlists.push({ id: 'pl_default', name: 'My Playlist', songs: venue.playlist });
    }
    delete venue.playlist;
  }
  // Ensure every playlist has a songs array
  venue.playlists = venue.playlists.map((p) => ({ ...p, songs: p.songs || [] }));
  if (!venue.activePlaylistId && venue.playlists.length > 0) {
    venue.activePlaylistId = venue.playlists[0].id;
  }
  return venue;
}

// GET /api/venue/:venueCode
router.get('/:venueCode', authMiddleware, (req, res) => {
  if (req.venue.code !== req.params.venueCode) return res.status(403).json({ error: 'Unauthorized' });
  const raw = db.getVenue(req.params.venueCode);
  const hadOldFormat = !Array.isArray(raw.playlists);
  const venue = normalizePlaylists({ ...raw });
  if (hadOldFormat) db.saveVenue(venue.code, venue);
  const out = { ...venue };
  delete out.owner;
  res.json(out);
});

// PUT /api/venue/:venueCode/settings
router.put('/:venueCode/settings', authMiddleware, (req, res) => {
  if (req.venue.code !== req.params.venueCode) return res.status(403).json({ error: 'Unauthorized' });

  const { allowExplicit, explicitAfterHour, maxSongsPerUser, genreFilters, blockedArtists, requirePaymentForRequest, requestPriceCents, autoplayQueue, autoplayMode } = req.body;
  const venue = db.getVenue(req.params.venueCode);
  if (!venue.settings) venue.settings = {};

  if (typeof allowExplicit === 'boolean') venue.settings.allowExplicit = allowExplicit;
  // Time-based explicit: null = use allowExplicit toggle, 0-23 = allow explicit after that hour
  if (explicitAfterHour !== undefined) {
    if (explicitAfterHour === null || explicitAfterHour === '') {
      delete venue.settings.explicitAfterHour;
    } else {
      const h = Number(explicitAfterHour);
      if (!isNaN(h) && h >= 0 && h <= 23) venue.settings.explicitAfterHour = h;
    }
  }
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
  // Playlist schedule: { playlistId, startHour, endHour, startMinute?, endMinute?, days? }
  // days: 0=Sun … 6=Sat. Autofill picks random songs from the matched playlist (shuffle-style).
  if (req.body.playlistSchedule !== undefined) {
    const schedule = req.body.playlistSchedule;
    if (Array.isArray(schedule)) {
      venue.settings.playlistSchedule = schedule
        .map((s) => {
          const startMinute = Number(s.startMinute);
          const endMinute = Number(s.endMinute);
          const days = Array.isArray(s.days)
            ? [...new Set(s.days.map(Number).filter((d) => d >= 0 && d <= 6))]
            : [];
          return {
            playlistId: String(s.playlistId),
            startHour: Number(s.startHour),
            endHour: Number(s.endHour),
            startMinute: Number.isFinite(startMinute) ? Math.min(59, Math.max(0, startMinute)) : 0,
            endMinute: Number.isFinite(endMinute) ? Math.min(59, Math.max(0, endMinute)) : 0,
            ...(days.length > 0 ? { days } : {}),
          };
        })
        .filter(
          (s) =>
            s.playlistId &&
            Number.isFinite(s.startHour) &&
            Number.isFinite(s.endHour) &&
            s.startHour >= 0 &&
            s.startHour <= 23 &&
            s.endHour >= 0 &&
            s.endHour <= 23
        );
    } else {
      delete venue.settings.playlistSchedule;
    }
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

// ── Multi-playlist CRUD ──────────────────────────────────────────────────────

// POST /api/venue/:venueCode/playlists – create a new named playlist
router.post('/:venueCode/playlists', authMiddleware, (req, res) => {
  if (req.venue.code !== req.params.venueCode) return res.status(403).json({ error: 'Unauthorized' });
  const { name } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Name is required' });

  const venue = normalizePlaylists(db.getVenue(req.params.venueCode));
  const playlist = { id: `pl_${Date.now()}`, name: name.trim(), songs: [] };
  venue.playlists.push(playlist);
  if (!venue.activePlaylistId) venue.activePlaylistId = playlist.id;
  db.saveVenue(venue.code, venue);
  res.json({ playlist, playlists: venue.playlists, activePlaylistId: venue.activePlaylistId });
});

// DELETE /api/venue/:venueCode/playlists/:playlistId – delete a playlist
router.delete('/:venueCode/playlists/:playlistId', authMiddleware, (req, res) => {
  if (req.venue.code !== req.params.venueCode) return res.status(403).json({ error: 'Unauthorized' });

  const venue = normalizePlaylists(db.getVenue(req.params.venueCode));
  venue.playlists = venue.playlists.filter((p) => p.id !== req.params.playlistId);
  if (venue.activePlaylistId === req.params.playlistId) {
    venue.activePlaylistId = venue.playlists[0]?.id || null;
  }
  db.saveVenue(venue.code, venue);
  res.json({ playlists: venue.playlists, activePlaylistId: venue.activePlaylistId });
});

// PUT /api/venue/:venueCode/playlists/:playlistId/activate – set as active (used by autofill)
router.put('/:venueCode/playlists/:playlistId/activate', authMiddleware, (req, res) => {
  if (req.venue.code !== req.params.venueCode) return res.status(403).json({ error: 'Unauthorized' });

  const venue = normalizePlaylists(db.getVenue(req.params.venueCode));
  if (!venue.playlists.some((p) => p.id === req.params.playlistId)) {
    return res.status(404).json({ error: 'Playlist not found' });
  }
  venue.activePlaylistId = req.params.playlistId;
  db.saveVenue(venue.code, venue);
  res.json({ activePlaylistId: venue.activePlaylistId });
});

// PUT /api/venue/:venueCode/playlists/:playlistId/rename – rename a playlist
router.put('/:venueCode/playlists/:playlistId/rename', authMiddleware, async (req, res) => {
  if (req.venue.code !== req.params.venueCode) return res.status(403).json({ error: 'Unauthorized' });
  const { name } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Name is required' });

  let rejection = null;
  const updated = await venueRepo.update(req.params.venueCode, (venue) => {
    normalizePlaylists(venue);
    const pl = venue.playlists.find((p) => p.id === req.params.playlistId);
    if (!pl) { rejection = { status: 404, body: { error: 'Playlist not found' } }; return null; }
    pl.name = name.trim();
    return venue;
  });
  if (rejection) return res.status(rejection.status).json(rejection.body);
  res.json({ playlists: updated.playlists });
});

// ── Per-playlist song management ─────────────────────────────────────────────

// POST /api/venue/:venueCode/playlists/:playlistId/songs – add a song
router.post('/:venueCode/playlists/:playlistId/songs', authMiddleware, async (req, res) => {
  if (req.venue.code !== req.params.venueCode) return res.status(403).json({ error: 'Unauthorized' });

  const { id, appleId, title, artist, albumArt, duration } = req.body;
  if (!appleId || !title) return res.status(400).json({ error: 'appleId and title are required' });

  let rejection = null;
  let resultPlaylist = null;
  await venueRepo.update(req.params.venueCode, (venue) => {
    normalizePlaylists(venue);
    const pl = venue.playlists.find((p) => p.id === req.params.playlistId);
    if (!pl) { rejection = { status: 404, body: { error: 'Playlist not found' } }; return null; }
    if (pl.songs.some((s) => s.appleId === appleId)) { resultPlaylist = pl; return null; }
    if (pl.songs.length >= 500) { rejection = { status: 400, body: { error: 'Playlist limit reached (500 songs)' } }; return null; }
    pl.songs.push({ id: id || `pl_${Date.now()}`, appleId, title, artist, albumArt, duration });
    resultPlaylist = pl;
    return venue;
  });

  if (rejection) return res.status(rejection.status).json(rejection.body);
  res.json({ playlist: resultPlaylist });
});

// DELETE /api/venue/:venueCode/playlists/:playlistId/songs/:appleId – remove a song
router.delete('/:venueCode/playlists/:playlistId/songs/:appleId', authMiddleware, async (req, res) => {
  if (req.venue.code !== req.params.venueCode) return res.status(403).json({ error: 'Unauthorized' });

  let resultPlaylist = null;
  let rejection = null;
  await venueRepo.update(req.params.venueCode, (venue) => {
    normalizePlaylists(venue);
    const pl = venue.playlists.find((p) => p.id === req.params.playlistId);
    if (!pl) { rejection = { status: 404, body: { error: 'Playlist not found' } }; return null; }
    pl.songs = pl.songs.filter((s) => s.appleId !== req.params.appleId);
    resultPlaylist = pl;
    return venue;
  });

  if (rejection) return res.status(rejection.status).json(rejection.body);
  res.json({ playlist: resultPlaylist });
});

// POST /api/venue/:venueCode/ban-artist – quick-ban an artist from the player
router.post('/:venueCode/ban-artist', authMiddleware, async (req, res) => {
  if (req.venue.code !== req.params.venueCode) return res.status(403).json({ error: 'Unauthorized' });
  const { artist } = req.body;
  if (!artist?.trim()) return res.status(400).json({ error: 'Artist name is required' });

  const updated = await venueRepo.update(req.params.venueCode, (venue) => {
    if (!venue.settings) venue.settings = {};
    if (!Array.isArray(venue.settings.blockedArtists)) venue.settings.blockedArtists = [];
    const normalized = artist.trim().toLowerCase();
    if (!venue.settings.blockedArtists.some((a) => a.toLowerCase() === normalized)) {
      venue.settings.blockedArtists.push(artist.trim());
    }
    return venue;
  });

  res.json({ success: true, blockedArtists: updated?.settings?.blockedArtists || [] });
});

// ── AI Playlist generation (R1 per song, min R25) ────────────────────────────

// POST /api/venue/:venueCode/playlists/:playlistId/generate-checkout
router.post('/:venueCode/playlists/:playlistId/generate-checkout', authMiddleware, async (req, res) => {
  if (req.venue.code !== req.params.venueCode) return res.status(403).json({ error: 'Unauthorized' });

  const { prompt, count: rawCount } = req.body;
  if (!prompt?.trim()) return res.status(400).json({ error: 'Prompt is required' });
  const count = Math.min(Math.max(Math.round(Number(rawCount) || 100), 25), 400);

  const venue = normalizePlaylists(db.getVenue(req.params.venueCode));
  if (!venue.playlists.some((p) => p.id === req.params.playlistId)) {
    return res.status(404).json({ error: 'Playlist not found' });
  }

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
        amount: count * 100, // R1 per song
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

    db.setPendingPayment(checkoutId, {
      venueCode,
      playlistId: req.params.playlistId,
      amountCents: count * 100,
      count,
      prompt: prompt.trim(),
    });
    res.json({ redirectUrl, checkoutId });
  } catch (err) {
    console.error('Generate checkout error:', err);
    res.status(500).json({ error: 'Could not create payment' });
  }
});

// POST /api/venue/:venueCode/playlists/:playlistId/generate – verify payment, call Claude, add songs
router.post('/:venueCode/playlists/:playlistId/generate', authMiddleware, async (req, res) => {
  if (req.venue.code !== req.params.venueCode) return res.status(403).json({ error: 'Unauthorized' });

  const { checkoutId, prompt: bodyPrompt, count: bodyCount } = req.body;
  if (!checkoutId) return res.status(400).json({ error: 'checkoutId required' });

  const pending = db.getPendingPayment(checkoutId);

  let resolvedPrompt;
  let resolvedPlaylistId = req.params.playlistId;
  let resolvedCount = 100;

  if (!pending) {
    // Server restarted — fall back to Yoco verification + client-supplied data
    if (!bodyPrompt?.trim()) return res.status(404).json({ error: 'Payment not found. Please try again.' });
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
    resolvedCount = Math.min(Math.max(Math.round(Number(bodyCount) || 100), 25), 400);
  } else {
    if (pending.venueCode !== req.params.venueCode) return res.status(403).json({ error: 'Invalid checkout' });
    resolvedPlaylistId = pending.playlistId || req.params.playlistId;
    resolvedCount = pending.count || Math.min(Math.max(Math.round(Number(bodyCount) || 100), 25), 400);
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
    // Ask Claude for search queries (artist names / keywords) rather than specific song titles.
    // This avoids hallucinated songs that don't exist on Apple Music — we let Apple Music's
    // catalog do the heavy lifting. Each query can return multiple real results.
    const numQueries = Math.min(Math.ceil(resolvedCount / 4) * 2, 200);
    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': anthropicKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 4096,
        system: `You are a music curator. Given a vibe or genre description, return ${numQueries} Apple Music search queries that will find real, existing songs. Each query should be an artist name, a song title with artist, or a style keyword phrase. Return ONLY valid JSON: {"queries":["query1","query2",...]}. No markdown. Vary artists and styles broadly. Only include real artists you are confident exist.`,
        messages: [{ role: 'user', content: `Search queries for: ${resolvedPrompt}` }],
      }),
    });
    if (!claudeRes.ok) throw new Error(`Claude API error: ${claudeRes.status}`);

    const claudeData = await claudeRes.json();
    let text = (claudeData?.content?.[0]?.text || '').trim();
    if (text.startsWith('```')) text = text.replace(/^```json?\n?/, '').replace(/\n?```$/, '');

    let queries = [];
    try { queries = JSON.parse(text).queries; } catch {
      const m = text.match(/\{[\s\S]*\}/);
      if (m) try { queries = JSON.parse(m[0]).queries; } catch {}
    }
    if (!Array.isArray(queries) || queries.length === 0) {
      return res.status(500).json({ error: 'AI returned no search queries' });
    }

    const { searchAppleMusic } = require('../utils/appleMusicAPI');
    const venue = normalizePlaylists(db.getVenue(req.params.venueCode));
    let pl = venue.playlists.find((p) => p.id === resolvedPlaylistId);
    if (!pl) {
      // Playlist deleted since payment — add to active or create a new one
      pl = venue.playlists.find((p) => p.id === venue.activePlaylistId);
      if (!pl) {
        pl = { id: `pl_${Date.now()}`, name: 'AI Generated', songs: [] };
        venue.playlists.push(pl);
        venue.activePlaylistId = pl.id;
      }
    }

    // Normalise title for dedup: strip version tags like "(Live at...)", "(2024 Remaster)", "(feat. ...)"
    const normKey = (title, artist) =>
      `${title}|${artist}`.toLowerCase().replace(/\s*[\(\[][^\)\]]*[\)\]]/g, '').replace(/[^a-z0-9|]/g, '');

    const existingIds = new Set(pl.songs.map((s) => s.appleId));
    const existingKeys = new Set(pl.songs.map((s) => normKey(s.title, s.artist)));
    const added = [];
    const spotsLeft = Math.min(resolvedCount, 500 - pl.songs.length);

    for (let i = 0; i < queries.length && added.length < spotsLeft; i += 5) {
      const batch = queries.slice(i, i + 5);
      // Take at most 3 results per query — the first results are most relevant.
      // Taking all 20 caused off-genre songs with the same title to flood the playlist.
      const MAX_PER_QUERY = 3;
      const batchResults = await Promise.all(batch.map(async (query) => {
        try { return (await searchAppleMusic(String(query))).slice(0, MAX_PER_QUERY); } catch { return []; }
      }));
      for (const songs of batchResults) {
        for (const song of songs) {
          const key = normKey(song.title, song.artist);
          // Deduplicate by both appleId and normalised title+artist (catches remasters, live versions, etc.)
          if (!song || existingIds.has(song.appleId) || existingKeys.has(key) || added.length >= spotsLeft || pl.songs.length >= 500) continue;
          const entry = { id: `pl_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, appleId: song.appleId, title: song.title, artist: song.artist, albumArt: song.albumArt, duration: song.duration };
          pl.songs.push(entry);
          existingIds.add(song.appleId);
          existingKeys.add(key);
          added.push(entry);
        }
      }
    }

    db.saveVenue(venue.code, venue);
    res.json({ added, total: pl.songs.length, playlistId: pl.id });
  } catch (err) {
    console.error('Generate playlist error:', err);
    res.status(500).json({ error: 'Failed to generate playlist' });
  }
});

// GET /api/venue/:venueCode/earnings
router.get('/:venueCode/earnings', authMiddleware, (req, res) => {
  if (req.venue.code !== req.params.venueCode) return res.status(403).json({ error: 'Unauthorized' });

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

// GET /api/venue/:venueCode/analytics?days=7
router.get('/:venueCode/analytics', authMiddleware, (req, res) => {
  if (req.venue.code !== req.params.venueCode) return res.status(403).json({ error: 'Unauthorized' });

  const days = Math.min(Math.max(parseInt(req.query.days, 10) || 7, 1), 30);
  const sinceMs = Date.now() - days * 24 * 60 * 60 * 1000;
  const events = db.getAnalytics(req.params.venueCode, sinceMs);

  // Aggregate: top requested songs, top artists, vote ratios, hourly activity
  const songRequests = {};
  const artistRequests = {};
  const hourlyActivity = Array(24).fill(0);
  let upvotes = 0;
  let downvotes = 0;
  const upvoteBySong = {};
  const downvoteBySong = {};

  // 10% volume bins: index 0 = 0–9%, … 9 = 90–100%
  const volumeTooLoudByBin = Array(10).fill(0);
  const volumeTooSoftByBin = Array(10).fill(0);
  let volumeFeedbackUnknown = 0;

  const songVoteKey = (e) =>
    `${e.songTitle || 'Unknown title'} — ${e.artist || 'Unknown artist'}`;

  for (const e of events) {
    const hour = new Date(e.timestamp).getHours();
    hourlyActivity[hour]++;

    if (e.type === 'request') {
      const key = `${e.songTitle} — ${e.artist}`;
      songRequests[key] = (songRequests[key] || 0) + 1;
      artistRequests[e.artist] = (artistRequests[e.artist] || 0) + 1;
    } else if (e.type === 'vote') {
      if (e.voteValue === 1) {
        upvotes++;
        const k = songVoteKey(e);
        upvoteBySong[k] = (upvoteBySong[k] || 0) + 1;
      } else if (e.voteValue === -1) {
        downvotes++;
        const k = songVoteKey(e);
        downvoteBySong[k] = (downvoteBySong[k] || 0) + 1;
      }
    } else if (e.type === 'volumeFeedback') {
      const pct = e.volumePercent;
      if (typeof pct !== 'number' || pct < 0 || pct > 100) {
        volumeFeedbackUnknown++;
        continue;
      }
      const bin = Math.min(9, Math.floor(pct / 10));
      if (e.direction === 'too_loud') volumeTooLoudByBin[bin]++;
      else if (e.direction === 'too_soft') volumeTooSoftByBin[bin]++;
    }
  }

  const topSongs = Object.entries(songRequests)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 20)
    .map(([name, count]) => ({ name, count }));

  const topArtists = Object.entries(artistRequests)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 10)
    .map(([name, count]) => ({ name, count }));

  const vfEvents = events.filter((e) => e.type === 'volumeFeedback');
  const volumeFeedback = {
    total: vfEvents.length,
    tooLoud: vfEvents.filter((e) => e.direction === 'too_loud').length,
    tooSoft: vfEvents.filter((e) => e.direction === 'too_soft').length,
    unknownVolume: volumeFeedbackUnknown,
    tooLoudByVolumeBin: volumeTooLoudByBin,
    tooSoftByVolumeBin: volumeTooSoftByBin,
    binLabels: ['0–9%', '10–19%', '20–29%', '30–39%', '40–49%', '50–59%', '60–69%', '70–79%', '80–89%', '90–100%'],
  };

  const votesUpBySong = Object.entries(upvoteBySong)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 100)
    .map(([name, count]) => ({ name, count }));

  const votesDownBySong = Object.entries(downvoteBySong)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 100)
    .map(([name, count]) => ({ name, count }));

  res.json({
    days,
    totalRequests: events.filter((e) => e.type === 'request').length,
    totalVotes: upvotes + downvotes,
    upvotes,
    downvotes,
    votesUpBySong,
    votesDownBySong,
    topSongs,
    topArtists,
    hourlyActivity,
    volumeFeedback,
  });
});

module.exports = router;
