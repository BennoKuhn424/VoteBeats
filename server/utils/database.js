const db = require('./sqlite');
const paymentCrypto = require('./paymentCrypto');

// ── Prepared statements (created once, reused) ──────────────────────────────

// Venues
const stmtGetVenue = db.prepare('SELECT * FROM venues WHERE code = ?');
const stmtGetAllVenues = db.prepare('SELECT * FROM venues');
const stmtUpsertVenue = db.prepare(`
  INSERT INTO venues (code, name, location, owner_email, owner_password_hash, settings, playlists, active_playlist_id, created_at)
  VALUES (@code, @name, @location, @owner_email, @owner_password_hash, @settings, @playlists, @active_playlist_id, @created_at)
  ON CONFLICT(code) DO UPDATE SET
    name = @name, location = @location, owner_email = @owner_email,
    owner_password_hash = @owner_password_hash, settings = @settings,
    playlists = @playlists, active_playlist_id = @active_playlist_id,
    created_at = @created_at
`);

// Queues
const stmtGetQueue = db.prepare('SELECT * FROM queues WHERE venue_code = ? ORDER BY position ASC, sort_order ASC');
const stmtDeleteQueue = db.prepare('DELETE FROM queues WHERE venue_code = ?');
const stmtInsertQueueSong = db.prepare(`
  INSERT OR REPLACE INTO queues (venue_code, position, sort_order, song_id, apple_id, provider_track_id,
    title, artist, album_art, duration, votes, requested_by, requested_at,
    position_ms, position_anchored_at, is_paused, genre)
  VALUES (@venue_code, @position, @sort_order, @song_id, @apple_id, @provider_track_id,
    @title, @artist, @album_art, @duration, @votes, @requested_by, @requested_at,
    @position_ms, @position_anchored_at, @is_paused, @genre)
`);

// Votes
const stmtGetVote = db.prepare('SELECT value FROM votes WHERE venue_code = ? AND song_id = ? AND device_id = ?');
const stmtSetVote = db.prepare(`
  INSERT INTO votes (venue_code, song_id, device_id, value) VALUES (?, ?, ?, ?)
  ON CONFLICT(venue_code, song_id, device_id) DO UPDATE SET value = excluded.value
`);
const stmtRemoveVote = db.prepare('DELETE FROM votes WHERE venue_code = ? AND song_id = ? AND device_id = ?');
const stmtGetVotesForDevice = db.prepare('SELECT song_id, value FROM votes WHERE venue_code = ? AND device_id = ?');
const stmtClearVotesForSong = db.prepare('DELETE FROM votes WHERE venue_code = ? AND song_id = ?');

// Pending payments
const stmtGetPending = db.prepare('SELECT * FROM pending_payments WHERE checkout_id = ?');
const stmtSetPending = db.prepare(`
  INSERT OR REPLACE INTO pending_payments (checkout_id, venue_code, song, device_id, amount_cents, created_at)
  VALUES (@checkout_id, @venue_code, @song, @device_id, @amount_cents, @created_at)
`);
const stmtRemovePending = db.prepare('DELETE FROM pending_payments WHERE checkout_id = ?');
const stmtPurgeStalePending = db.prepare('DELETE FROM pending_payments WHERE created_at < ?');

// Payments
const stmtAddPayment = db.prepare('INSERT INTO payments (id, venue_code, amount_cents, created_at) VALUES (?, ?, ?, ?)');
const stmtGetPaymentsForVenueMonth = db.prepare(
  'SELECT * FROM payments WHERE venue_code = ? AND created_at >= ? AND created_at <= ?'
);
const stmtGetPaymentsForMonth = db.prepare(
  'SELECT * FROM payments WHERE created_at >= ? AND created_at <= ?'
);
const stmtGetAllPayments = db.prepare('SELECT * FROM payments');
const stmtGetRecentPayments = db.prepare('SELECT * FROM payments ORDER BY created_at DESC LIMIT 20');

// Analytics
const stmtInsertAnalytics = db.prepare(
  'INSERT INTO analytics (venue_code, data, timestamp) VALUES (?, ?, ?)'
);
const stmtGetAnalytics = db.prepare(
  'SELECT data, timestamp FROM analytics WHERE venue_code = ? ORDER BY timestamp ASC'
);
const stmtGetAnalyticsSince = db.prepare(
  'SELECT data, timestamp FROM analytics WHERE venue_code = ? AND timestamp >= ? ORDER BY timestamp ASC'
);
const stmtPruneAnalytics = db.prepare(`
  DELETE FROM analytics WHERE venue_code = ? AND id NOT IN (
    SELECT id FROM analytics WHERE venue_code = ? ORDER BY timestamp DESC LIMIT 5000
  )
`);
const stmtCountAnalytics24h = db.prepare(
  'SELECT COUNT(*) as cnt FROM analytics WHERE timestamp >= ?'
);

// Player volume
const stmtGetVolume = db.prepare('SELECT percent, updated_at FROM player_volume WHERE venue_code = ?');
const stmtSetVolume = db.prepare(`
  INSERT INTO player_volume (venue_code, percent, updated_at) VALUES (?, ?, ?)
  ON CONFLICT(venue_code) DO UPDATE SET percent = excluded.percent, updated_at = excluded.updated_at
`);

// Auth tokens
const stmtGetAuthToken = db.prepare('SELECT * FROM auth_tokens WHERE token = ?');
const stmtSaveAuthToken = db.prepare(`
  INSERT OR REPLACE INTO auth_tokens (token, email, type, expires_at, created_at, venue_code)
  VALUES (@token, @email, @type, @expires_at, @created_at, @venue_code)
`);
const stmtRemoveAuthToken = db.prepare('DELETE FROM auth_tokens WHERE token = ?');
const stmtRemoveAuthTokensByEmail = db.prepare('DELETE FROM auth_tokens WHERE email = ? AND type = ?');
const stmtPurgeExpiredTokens = db.prepare('DELETE FROM auth_tokens WHERE expires_at < ?');

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Reconstruct a venue object from a DB row to match the old JSON shape. */
function rowToVenue(row) {
  if (!row) return undefined;
  return {
    code: row.code,
    name: row.name,
    location: row.location || '',
    owner: {
      email: row.owner_email,
      passwordHash: row.owner_password_hash,
    },
    settings: safeParseJSON(row.settings, {}),
    playlists: safeParseJSON(row.playlists, []),
    activePlaylistId: row.active_playlist_id || undefined,
    createdAt: row.created_at,
  };
}

/** Flatten a venue object into DB row params. */
function venueToRow(code, venue) {
  return {
    code,
    name: venue.name || code,
    location: venue.location || '',
    owner_email: venue.owner?.email || '',
    owner_password_hash: venue.owner?.passwordHash || '',
    settings: JSON.stringify(venue.settings || {}),
    playlists: JSON.stringify(venue.playlists || []),
    active_playlist_id: venue.activePlaylistId || null,
    created_at: venue.createdAt || new Date().toISOString(),
  };
}

/** Reconstruct a queue song object from a DB row. */
function rowToSong(row) {
  const song = {
    id: row.song_id,
    appleId: row.apple_id || row.provider_track_id || null,
    title: row.title,
    artist: row.artist,
    albumArt: row.album_art || '',
    duration: row.duration || 0,
    votes: row.votes || 0,
    requestedBy: row.requested_by || null,
    requestedAt: row.requested_at || null,
    genre: row.genre || '',
  };
  if (row.provider_track_id) song.providerTrackId = row.provider_track_id;
  // nowPlaying-specific fields
  if (row.position === 'now_playing') {
    song.positionMs = row.position_ms || 0;
    song.positionAnchoredAt = row.position_anchored_at || null;
    song.isPaused = row.is_paused === 1;
  }
  return song;
}

/** Flatten a song object into DB row params. */
function songToRow(venueCode, song, position, sortOrder) {
  return {
    venue_code: venueCode,
    position,
    sort_order: sortOrder,
    song_id: song.id,
    apple_id: song.appleId || null,
    provider_track_id: song.providerTrackId || song.appleId || null,
    title: song.title || '',
    artist: song.artist || '',
    album_art: song.albumArt || '',
    duration: song.duration || 0,
    votes: song.votes || 0,
    requested_by: song.requestedBy || null,
    requested_at: song.requestedAt || null,
    position_ms: song.positionMs || 0,
    position_anchored_at: song.positionAnchoredAt || null,
    is_paused: song.isPaused ? 1 : 0,
    genre: song.genre || '',
  };
}

function safeParseJSON(str, fallback) {
  if (typeof str !== 'string') return str ?? fallback;
  try { return JSON.parse(str); } catch { return fallback; }
}

/** Encrypt a string if encryption is enabled, otherwise return as-is. */
function maybeEncrypt(str) {
  if (!paymentCrypto.ENABLED) return str;
  return paymentCrypto.encrypt(str) || str;
}

/** Decrypt a string if it looks encrypted, otherwise return as-is. */
function maybeDecrypt(str) {
  if (!paymentCrypto.ENABLED || !str) return str;
  // If it's valid JSON as-is, it's plaintext (pre-migration)
  try { JSON.parse(str); return str; } catch { /* not JSON, try decrypt */ }
  const decrypted = paymentCrypto.decrypt(str);
  return decrypted !== null ? decrypted : str;
}

// ── Transactional helpers ───────────────────────────────────────────────────

const writeQueueTransaction = db.transaction((venueCode, queue) => {
  stmtDeleteQueue.run(venueCode);
  if (queue.nowPlaying) {
    stmtInsertQueueSong.run(songToRow(venueCode, queue.nowPlaying, 'now_playing', 0));
  }
  if (Array.isArray(queue.upcoming)) {
    for (let i = 0; i < queue.upcoming.length; i++) {
      stmtInsertQueueSong.run(songToRow(venueCode, queue.upcoming[i], 'upcoming', i));
    }
  }
});

// ── Exports (same API as old JSON-based database.js) ────────────────────────

module.exports = {
  // Venues
  getVenue: (code) => {
    const row = stmtGetVenue.get(code);
    return rowToVenue(row);
  },

  getAllVenues: () => {
    const rows = stmtGetAllVenues.all();
    const result = {};
    for (const row of rows) {
      result[row.code] = rowToVenue(row);
    }
    return result;
  },

  saveVenue: (code, venue) => {
    stmtUpsertVenue.run(venueToRow(code, venue));
  },

  // Queues
  getQueue: (venueCode) => {
    const rows = stmtGetQueue.all(venueCode);
    let nowPlaying = null;
    const upcoming = [];
    for (const row of rows) {
      if (row.position === 'now_playing') {
        nowPlaying = rowToSong(row);
      } else {
        upcoming.push(rowToSong(row));
      }
    }
    return { nowPlaying, upcoming };
  },

  getQueues: () => {
    const allRows = db.prepare('SELECT * FROM queues ORDER BY venue_code, position ASC, sort_order ASC').all();
    const result = {};
    for (const row of allRows) {
      if (!result[row.venue_code]) result[row.venue_code] = { nowPlaying: null, upcoming: [] };
      if (row.position === 'now_playing') {
        result[row.venue_code].nowPlaying = rowToSong(row);
      } else {
        result[row.venue_code].upcoming.push(rowToSong(row));
      }
    }
    return result;
  },

  updateQueue: (venueCode, queue) => {
    writeQueueTransaction(venueCode, queue);
  },

  // Votes
  getVote: (venueCode, songId, deviceId) => {
    const row = stmtGetVote.get(venueCode, songId, deviceId);
    return row ? row.value : undefined;
  },

  setVote: (venueCode, songId, deviceId, value) => {
    stmtSetVote.run(venueCode, songId, deviceId, value);
  },

  removeVote: (venueCode, songId, deviceId) => {
    stmtRemoveVote.run(venueCode, songId, deviceId);
  },

  getVotesForDevice: (venueCode, deviceId) => {
    const rows = stmtGetVotesForDevice.all(venueCode, deviceId);
    const result = {};
    for (const row of rows) {
      result[row.song_id] = row.value;
    }
    return result;
  },

  clearVotesForSong: (venueCode, songId) => {
    stmtClearVotesForSong.run(venueCode, songId);
  },

  // Pending payments
  getPendingPayment: (checkoutId) => {
    const row = stmtGetPending.get(checkoutId);
    if (!row) return null;
    const songStr = maybeDecrypt(row.song);
    const deviceId = maybeDecrypt(row.device_id);
    return {
      venueCode: row.venue_code,
      song: safeParseJSON(songStr, {}),
      deviceId,
      amountCents: row.amount_cents,
      createdAt: row.created_at,
    };
  },

  setPendingPayment: (checkoutId, data) => {
    stmtSetPending.run({
      checkout_id: checkoutId,
      venue_code: data.venueCode,
      song: maybeEncrypt(JSON.stringify(data.song || {})),
      device_id: maybeEncrypt(data.deviceId || ''),
      amount_cents: data.amountCents || 0,
      created_at: Date.now(),
    });
  },

  removePendingPayment: (checkoutId) => {
    stmtRemovePending.run(checkoutId);
  },

  purgeStalePendingPayments: (maxAgeMs) => {
    const cutoff = Date.now() - maxAgeMs;
    const result = stmtPurgeStalePending.run(cutoff);
    return result.changes;
  },

  // Payments log
  addPayment: (venueCode, amountCents, checkoutId) => {
    const id = `pay_${Date.now()}_${checkoutId || ''}`.slice(0, 50);
    stmtAddPayment.run(id, venueCode, amountCents, Date.now());
  },

  getVenueEarningsForMonth: (venueCode, year, month) => {
    const start = new Date(year, month - 1, 1).getTime();
    const end = new Date(year, month, 0, 23, 59, 59, 999).getTime();
    const rows = stmtGetPaymentsForVenueMonth.all(venueCode, start, end);
    const grossCents = rows.reduce((sum, p) => sum + (p.amount_cents || 0), 0);
    return {
      grossCents,
      count: rows.length,
      payments: rows.map((p) => ({
        id: p.id,
        venueCode: p.venue_code,
        amountCents: p.amount_cents,
        createdAt: p.created_at,
      })),
    };
  },

  // Analytics
  recordAnalyticsEvent: (venueCode, event) => {
    const data = JSON.stringify({ ...event });
    const now = Date.now();
    stmtInsertAnalytics.run(venueCode, data, now);
    // Prune to keep last 5000 per venue
    stmtPruneAnalytics.run(venueCode, venueCode);
  },

  getAnalytics: (venueCode, sinceMs) => {
    const rows = sinceMs
      ? stmtGetAnalyticsSince.all(venueCode, sinceMs)
      : stmtGetAnalytics.all(venueCode);
    return rows.map((r) => {
      const parsed = safeParseJSON(r.data, {});
      return { ...parsed, timestamp: r.timestamp };
    });
  },

  // Player volume
  getPlayerVolumeReport: (venueCode) => {
    const row = stmtGetVolume.get(venueCode);
    if (!row || typeof row.percent !== 'number') return null;
    return { percent: row.percent, updatedAt: row.updated_at || 0 };
  },

  setPlayerVolumeReport: (venueCode, percent) => {
    const p = Math.round(Math.max(0, Math.min(100, Number(percent) || 0)));
    stmtSetVolume.run(venueCode, p, Date.now());
  },

  // Auth tokens
  getAuthToken: (token) => {
    const row = stmtGetAuthToken.get(token);
    if (!row) return null;
    return {
      email: row.email,
      type: row.type,
      expiresAt: row.expires_at,
      createdAt: row.created_at,
      venueCode: row.venue_code || undefined,
    };
  },

  saveAuthToken: (token, data) => {
    stmtSaveAuthToken.run({
      token,
      email: data.email,
      type: data.type,
      expires_at: data.expiresAt,
      created_at: Date.now(),
      venue_code: data.venueCode || null,
    });
  },

  removeAuthToken: (token) => {
    stmtRemoveAuthToken.run(token);
  },

  removeAuthTokensByEmail: (email, type) => {
    stmtRemoveAuthTokensByEmail.run(email, type);
  },

  purgeExpiredAuthTokens: () => {
    const result = stmtPurgeExpiredTokens.run(Date.now());
    return result.changes;
  },

  getAllVenueEarningsForMonth: (year, month) => {
    const start = new Date(year, month - 1, 1).getTime();
    const end = new Date(year, month, 0, 23, 59, 59, 999).getTime();
    const rows = stmtGetPaymentsForMonth.all(start, end);
    const byVenue = {};
    for (const p of rows) {
      if (!byVenue[p.venue_code]) byVenue[p.venue_code] = { grossCents: 0, count: 0 };
      byVenue[p.venue_code].grossCents += p.amount_cents || 0;
      byVenue[p.venue_code].count += 1;
    }
    return byVenue;
  },

  getOwnerOverview: () => {
    const venueRows = stmtGetAllVenues.all();
    const venueList = venueRows.map((v) => ({
      code: v.code,
      name: v.name || v.code,
      location: v.location || '',
      createdAt: v.created_at || null,
    }));

    const allPayments = stmtGetAllPayments.all();
    const allTimeGrossCents = allPayments.reduce((s, p) => s + (p.amount_cents || 0), 0);

    const now = new Date();
    const y = now.getFullYear();
    const m = now.getMonth() + 1;
    const start = new Date(y, m - 1, 1).getTime();
    const end = new Date(y, m, 0, 23, 59, 59, 999).getTime();
    const thisMonth = allPayments.filter((p) => p.created_at >= start && p.created_at <= end);
    const monthGrossCents = thisMonth.reduce((s, p) => s + (p.amount_cents || 0), 0);

    const venueSharePercent = parseInt(process.env.VENUE_EARNINGS_PERCENT, 10);
    const vsp = Number.isFinite(venueSharePercent) && venueSharePercent >= 0 && venueSharePercent <= 100
      ? venueSharePercent
      : 80;
    const platformSharePercent = 100 - vsp;

    const allTimePlatformCents = Math.round(allTimeGrossCents * (platformSharePercent / 100));
    const allTimeVenueCents = Math.round(allTimeGrossCents * (vsp / 100));
    const monthPlatformCents = Math.round(monthGrossCents * (platformSharePercent / 100));
    const monthVenueCents = Math.round(monthGrossCents * (vsp / 100));

    const byVenue = {};
    thisMonth.forEach((p) => {
      const vc = p.venue_code;
      if (!byVenue[vc]) byVenue[vc] = { grossCents: 0, count: 0 };
      byVenue[vc].grossCents += p.amount_cents || 0;
      byVenue[vc].count += 1;
    });

    const venues = {};
    for (const v of venueRows) venues[v.code] = v;

    const venueMonthRows = Object.entries(byVenue)
      .map(([code, data]) => ({
        venueCode: code,
        venueName: venues[code]?.name || code,
        grossCents: data.grossCents,
        grossRand: (data.grossCents / 100).toFixed(2),
        platformShareRand: ((data.grossCents * platformSharePercent) / 100 / 100).toFixed(2),
        paymentsCount: data.count,
      }))
      .sort((a, b) => b.grossCents - a.grossCents);

    const recentRows = stmtGetRecentPayments.all();
    const recentPayments = recentRows.map((p) => ({
      venueCode: p.venue_code,
      amountCents: p.amount_cents,
      amountRand: ((p.amount_cents || 0) / 100).toFixed(2),
      createdAt: p.created_at,
    }));

    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    const analyticsEvents24h = stmtCountAnalytics24h.get(cutoff)?.cnt || 0;

    return {
      venueCount: venueList.length,
      venues: venueList,
      allTimeGrossCents,
      allTimeGrossRand: (allTimeGrossCents / 100).toFixed(2),
      allTimePlatformCents,
      allTimePlatformRand: (allTimePlatformCents / 100).toFixed(2),
      allTimeVenueCents,
      allTimeVenueRand: (allTimeVenueCents / 100).toFixed(2),
      monthGrossCents,
      monthGrossRand: (monthGrossCents / 100).toFixed(2),
      monthPlatformCents,
      monthPlatformRand: (monthPlatformCents / 100).toFixed(2),
      monthVenueCents,
      monthVenueRand: (monthVenueCents / 100).toFixed(2),
      venueSharePercent: vsp,
      platformSharePercent,
      paymentCountAllTime: allPayments.length,
      paymentCountMonth: thisMonth.length,
      venueMonthRows,
      recentPayments,
      analyticsEvents24h,
      monthLabel: `${y}-${String(m).padStart(2, '0')}`,
    };
  },
};
