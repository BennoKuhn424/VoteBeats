const fs = require('fs');
const path = require('path');

// Use DATA_DIR env var to point at a Render Persistent Disk (survives redeploys).
// Falls back to the local ./data folder for development.
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '../data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
console.log('[DB] Data directory:', DATA_DIR, process.env.DATA_DIR ? '(persistent)' : '(ephemeral - set DATA_DIR for Render disk)');

// In-memory write-through cache — avoids a readFileSync on every hot-path read.
// Cache entries are populated on first read and kept in sync on every successful write.
const cache = {};

function readJSON(filename) {
  if (cache[filename] !== undefined) return cache[filename];
  const filepath = path.join(DATA_DIR, filename);
  let data;
  if (fs.existsSync(filepath)) {
    try {
      const raw = fs.readFileSync(filepath, 'utf8');
      data = JSON.parse(raw);
    } catch (err) {
      console.error(`[DB] Corrupt or unreadable ${filename}, using empty object:`, err.message);
      data = {};
    }
  } else {
    data = {};
  }
  cache[filename] = data;
  return data;
}

/**
 * Persist JSON atomically: write to a temp file, then rename (same filesystem).
 * Cache is updated only after a successful write so a failed disk write cannot
 * leave memory and disk inconsistent.
 */
function writeJSON(filename, data) {
  const filepath = path.join(DATA_DIR, filename);
  const json = JSON.stringify(data, null, 2);
  const tmp = path.join(
    DATA_DIR,
    `.${filename}.${process.pid}.${Date.now()}.tmp`
  );
  try {
    fs.writeFileSync(tmp, json, 'utf8');
    fs.renameSync(tmp, filepath);
    cache[filename] = data;
  } catch (err) {
    try {
      if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
    } catch (_) {
      /* ignore */
    }
    throw err;
  }
}

module.exports = {
  // Venues
  getVenue: (code) => readJSON('venues.json')[code],
  getAllVenues: () => readJSON('venues.json'),
  saveVenue: (code, venue) => {
    const venues = readJSON('venues.json');
    venues[code] = venue;
    writeJSON('venues.json', venues);
  },

  // Queues
  getQueue: (venueCode) => {
    const queues = readJSON('queues.json');
    return queues[venueCode] || { nowPlaying: null, upcoming: [] };
  },
  getQueues: () => readJSON('queues.json'),
  updateQueue: (venueCode, queue) => {
    const queues = readJSON('queues.json');
    queues[venueCode] = queue;
    writeJSON('queues.json', queues);
  },

  // Votes
  getVote: (venueCode, songId, deviceId) => {
    const votes = readJSON('votes.json');
    return votes[venueCode]?.[songId]?.[deviceId];
  },
  setVote: (venueCode, songId, deviceId, value) => {
    const votes = readJSON('votes.json');
    if (!votes[venueCode]) votes[venueCode] = {};
    if (!votes[venueCode][songId]) votes[venueCode][songId] = {};
    votes[venueCode][songId][deviceId] = value;
    writeJSON('votes.json', votes);
  },
  removeVote: (venueCode, songId, deviceId) => {
    const votes = readJSON('votes.json');
    if (votes[venueCode]?.[songId]) {
      delete votes[venueCode][songId][deviceId];
      writeJSON('votes.json', votes);
    }
  },
  getVotesForDevice: (venueCode, deviceId) => {
    const votes = readJSON('votes.json');
    const venueVotes = votes[venueCode] || {};
    const result = {};
    for (const [songId, devices] of Object.entries(venueVotes)) {
      if (devices[deviceId]) result[songId] = devices[deviceId];
    }
    return result;
  },
  clearVotesForSong: (venueCode, songId) => {
    const votes = readJSON('votes.json');
    if (votes[venueCode]) {
      delete votes[venueCode][songId];
      writeJSON('votes.json', votes);
    }
  },

  // Pending payments (Yoco checkoutId -> { venueCode, song, deviceId })
  getPendingPayment: (checkoutId) => {
    const pending = readJSON('pendingPayments.json');
    return pending[checkoutId] || null;
  },
  setPendingPayment: (checkoutId, data) => {
    const pending = readJSON('pendingPayments.json');
    pending[checkoutId] = { ...data, createdAt: Date.now() };
    writeJSON('pendingPayments.json', pending);
  },
  removePendingPayment: (checkoutId) => {
    const pending = readJSON('pendingPayments.json');
    if (pending[checkoutId]) {
      delete pending[checkoutId];
      writeJSON('pendingPayments.json', pending);
    }
  },
  /** Remove pending checkout rows older than maxAgeMs (abandoned checkouts). */
  purgeStalePendingPayments: (maxAgeMs) => {
    const pending = readJSON('pendingPayments.json');
    const now = Date.now();
    let removed = 0;
    for (const [id, row] of Object.entries(pending)) {
      const created = row?.createdAt || 0;
      if (now - created > maxAgeMs) {
        delete pending[id];
        removed += 1;
      }
    }
    if (removed > 0) writeJSON('pendingPayments.json', pending);
    return removed;
  },

  // Payments log (for earnings tracking)
  addPayment: (venueCode, amountCents, checkoutId) => {
    let payments = readJSON('payments.json');
    if (!payments || typeof payments !== 'object') payments = {};
    const list = Array.isArray(payments.list) ? payments.list : [];
    list.push({
      id: `pay_${Date.now()}_${checkoutId || ''}`.slice(0, 50),
      venueCode,
      amountCents,
      createdAt: Date.now(),
    });
    payments.list = list;
    writeJSON('payments.json', payments);
  },
  getVenueEarningsForMonth: (venueCode, year, month) => {
    const payments = readJSON('payments.json');
    const list = Array.isArray(payments.list) ? payments.list : [];
    const start = new Date(year, month - 1, 1).getTime();
    const end = new Date(year, month, 0, 23, 59, 59, 999).getTime();
    const forVenue = list.filter(
      (p) => p.venueCode === venueCode && p.createdAt >= start && p.createdAt <= end
    );
    const grossCents = forVenue.reduce((sum, p) => sum + (p.amountCents || 0), 0);
    return { grossCents, count: forVenue.length, payments: forVenue };
  },
  // Analytics: track song requests, plays, and votes
  recordAnalyticsEvent: (venueCode, event) => {
    let analytics = readJSON('analytics.json');
    if (!analytics || typeof analytics !== 'object') analytics = {};
    if (!analytics[venueCode]) analytics[venueCode] = [];
    analytics[venueCode].push({ ...event, timestamp: Date.now() });
    // Keep last 5000 events per venue
    if (analytics[venueCode].length > 5000) {
      analytics[venueCode] = analytics[venueCode].slice(-5000);
    }
    writeJSON('analytics.json', analytics);
  },
  getAnalytics: (venueCode, sinceMs) => {
    const analytics = readJSON('analytics.json');
    const events = analytics[venueCode] || [];
    if (sinceMs) return events.filter((e) => e.timestamp >= sinceMs);
    return events;
  },

  // Last volume reported by venue player (for customer feedback correlation)
  getPlayerVolumeReport: (venueCode) => {
    const data = readJSON('playerVolume.json');
    const row = data[venueCode];
    if (!row || typeof row.percent !== 'number') return null;
    return { percent: row.percent, updatedAt: row.updatedAt || 0 };
  },
  setPlayerVolumeReport: (venueCode, percent) => {
    const p = Math.round(Math.max(0, Math.min(100, Number(percent) || 0)));
    const data = readJSON('playerVolume.json');
    data[venueCode] = { percent: p, updatedAt: Date.now() };
    writeJSON('playerVolume.json', data);
  },

  getAllVenueEarningsForMonth: (year, month) => {
    const payments = readJSON('payments.json');
    const list = Array.isArray(payments.list) ? payments.list : [];
    const start = new Date(year, month - 1, 1).getTime();
    const end = new Date(year, month, 0, 23, 59, 59, 999).getTime();
    const forMonth = list.filter((p) => p.createdAt >= start && p.createdAt <= end);
    const byVenue = {};
    forMonth.forEach((p) => {
      if (!byVenue[p.venueCode]) byVenue[p.venueCode] = { grossCents: 0, count: 0 };
      byVenue[p.venueCode].grossCents += p.amountCents || 0;
      byVenue[p.venueCode].count += 1;
    });
    return byVenue;
  },

  /** Platform owner dashboard — aggregates across all venues */
  getOwnerOverview: () => {
    const venues = readJSON('venues.json');
    const venueList = Object.entries(venues).map(([code, v]) => ({
      code,
      name: v.name || code,
      location: v.location || '',
      createdAt: v.createdAt || null,
    }));

    const payments = readJSON('payments.json');
    const list = Array.isArray(payments.list) ? payments.list : [];
    const allTimeGrossCents = list.reduce((s, p) => s + (p.amountCents || 0), 0);

    const now = new Date();
    const y = now.getFullYear();
    const m = now.getMonth() + 1;
    const start = new Date(y, m - 1, 1).getTime();
    const end = new Date(y, m, 0, 23, 59, 59, 999).getTime();
    const thisMonth = list.filter((p) => p.createdAt >= start && p.createdAt <= end);
    const monthGrossCents = thisMonth.reduce((s, p) => s + (p.amountCents || 0), 0);

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
      if (!byVenue[p.venueCode]) byVenue[p.venueCode] = { grossCents: 0, count: 0 };
      byVenue[p.venueCode].grossCents += p.amountCents || 0;
      byVenue[p.venueCode].count += 1;
    });
    const venueMonthRows = Object.entries(byVenue)
      .map(([code, data]) => {
        const v = venues[code];
        return {
          venueCode: code,
          venueName: v?.name || code,
          grossCents: data.grossCents,
          grossRand: (data.grossCents / 100).toFixed(2),
          platformShareRand: ((data.grossCents * platformSharePercent) / 100 / 100).toFixed(2),
          paymentsCount: data.count,
        };
      })
      .sort((a, b) => b.grossCents - a.grossCents);

    const recentPayments = [...list]
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 20)
      .map((p) => ({
        venueCode: p.venueCode,
        amountCents: p.amountCents,
        amountRand: ((p.amountCents || 0) / 100).toFixed(2),
        createdAt: p.createdAt,
      }));

    let analyticsEvents24h = 0;
    try {
      const analytics = readJSON('analytics.json');
      const cutoff = Date.now() - 24 * 60 * 60 * 1000;
      for (const events of Object.values(analytics)) {
        if (!Array.isArray(events)) continue;
        analyticsEvents24h += events.filter((e) => e.timestamp >= cutoff).length;
      }
    } catch (_) {
      /* ignore */
    }

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
      paymentCountAllTime: list.length,
      paymentCountMonth: thisMonth.length,
      venueMonthRows,
      recentPayments,
      analyticsEvents24h,
      monthLabel: `${y}-${String(m).padStart(2, '0')}`,
    };
  },
};
