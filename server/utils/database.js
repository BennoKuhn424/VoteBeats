const fs = require('fs');
const path = require('path');

// Use DATA_DIR env var to point at a Render Persistent Disk (survives redeploys).
// Falls back to the local ./data folder for development.
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '../data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
console.log('[DB] Data directory:', DATA_DIR, process.env.DATA_DIR ? '(persistent)' : '(ephemeral - set DATA_DIR for Render disk)');

// In-memory write-through cache — avoids a readFileSync on every hot-path read.
// Cache entries are populated on first read and kept in sync on every write.
const cache = {};

function readJSON(filename) {
  if (cache[filename] !== undefined) return cache[filename];
  const filepath = path.join(DATA_DIR, filename);
  const data = fs.existsSync(filepath)
    ? JSON.parse(fs.readFileSync(filepath, 'utf8'))
    : {};
  cache[filename] = data;
  return data;
}

function writeJSON(filename, data) {
  cache[filename] = data;
  const filepath = path.join(DATA_DIR, filename);
  fs.writeFileSync(filepath, JSON.stringify(data, null, 2));
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
};
