const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '../data');

function readJSON(filename) {
  const filepath = path.join(DATA_DIR, filename);
  if (!fs.existsSync(filepath)) {
    return {};
  }
  return JSON.parse(fs.readFileSync(filepath, 'utf8'));
}

function writeJSON(filename, data) {
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
