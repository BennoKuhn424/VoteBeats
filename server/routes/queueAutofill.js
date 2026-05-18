const db = require('../utils/database');
const { getProvider } = require('../providers');
const broadcast = require('../utils/broadcast');
const { logEvent } = require('../utils/logEvent');
const queueRepo = require('../repos/queueRepo');
const { findScheduledPlaylist } = require('../utils/playlistSchedule');

const pendingAutofillVenues = new Set();

async function serverAutofill(venueCode, venue) {
  if (pendingAutofillVenues.has(venueCode)) return;
  pendingAutofillVenues.add(venueCode);
  try {
    const preCheck = queueRepo.get(venueCode);
    if (preCheck.nowPlaying || (preCheck.upcoming && preCheck.upcoming.length > 0)) return;

    // Only `playlist` mode autofills. `off` (and any legacy/unknown value)
    // returns without playing — random autoplay was removed 2026-05-18.
    const autoplayMode = venue?.settings?.autoplayMode || 'playlist';
    if (autoplayMode !== 'playlist') return;

    const playlists = venue?.playlists || [];

    let activePl = null;
    const schedule = venue?.settings?.playlistSchedule;
    if (Array.isArray(schedule) && schedule.length > 0) {
      activePl = findScheduledPlaylist(schedule, playlists, new Date(), venue?.settings?.timezone);
    }
    if (!activePl) {
      activePl = playlists.find((p) => p.id === venue?.activePlaylistId)
        || playlists.find((p) => p.songs?.length > 0);
    }
    const playlist = activePl?.songs || venue?.playlist || [];
    if (playlist.length === 0) return;

    const provider = getProvider();
    const song = provider.pickFromPlaylist(playlist, venueCode);
    if (!song) return;

    const now = Date.now();
    const autofillSong = {
      ...song,
      id: song.id || `autofill_${now}`,
      votes: 0,
      requestedBy: '__autofill__',
      requestedAt: now,
      positionMs: 0,
      positionAnchoredAt: now,
      isPaused: false,
    };

    const written = await queueRepo.update(venueCode, (queue) => {
      if (queue.nowPlaying || (queue.upcoming && queue.upcoming.length > 0)) return null;
      return { nowPlaying: autofillSong, upcoming: [] };
    });

    if (written.nowPlaying?.id === autofillSong.id) {
      logEvent({ venueCode, action: 'autofill', songId: autofillSong.id, detail: `"${autofillSong.title}" autofilled (server)` });
      broadcast.broadcastQueue(venueCode, written);
    }
  } finally {
    pendingAutofillVenues.delete(venueCode);
  }
}

async function autofillIfQueueEmpty(venueCode) {
  const queue = queueRepo.get(venueCode);
  if (queue.nowPlaying || (queue.upcoming?.length ?? 0) > 0) return null;
  const venue = db.getVenue(venueCode);
  if (!venue) return null;
  const s = venue?.settings;
  if (s?.autoplayMode === 'off' || s?.autoplayQueue === false) return null;
  // serverAutofill broadcasts internally when it actually wrote a song —
  // don't double-emit here.
  await serverAutofill(venueCode, venue).catch((err) => console.error('Autofill error:', err));
  return queueRepo.get(venueCode);
}

function attachAutofillRoutes(router) {
  router.get('/:venueCode/autofill', async (req, res) => {
    const { venueCode } = req.params;
    const venue = db.getVenue(venueCode);
    if (!venue) return res.status(404).json({ error: 'Venue not found' });

    const preCheck = queueRepo.get(venueCode);
    if (preCheck.nowPlaying || (preCheck.upcoming && preCheck.upcoming.length > 0)) {
      return res.json({ filled: false, reason: 'Queue is not empty' });
    }

    try {
      const autoplayMode = venue.settings?.autoplayMode || 'playlist';
      if (autoplayMode !== 'playlist') {
        return res.json({ filled: false, reason: 'Autoplay is off' });
      }

      const playlists = venue.playlists || [];

      let activePl = null;
      const schedule = venue.settings?.playlistSchedule;
      if (Array.isArray(schedule) && schedule.length > 0) {
        activePl = findScheduledPlaylist(schedule, playlists, new Date(), venue.settings?.timezone);
      }
      if (!activePl) {
        activePl = playlists.find((p) => p.id === venue.activePlaylistId)
          || playlists.find((p) => p.songs?.length > 0);
      }
      const playlist = activePl?.songs || venue.playlist || [];
      if (playlist.length === 0) {
        return res.json({ filled: false, reason: 'No playlist songs available' });
      }

      const provider = getProvider();
      const song = provider.pickFromPlaylist(playlist, venueCode);
      if (!song) {
        return res.json({ filled: false, reason: 'No songs found' });
      }

      const now = Date.now();
      const newSong = {
        ...song,
        id: song.id || `autofill_${now}`,
        votes: 0,
        requestedBy: '__autofill__',
        requestedAt: now,
      };

      const written = await queueRepo.update(venueCode, (queue) => {
        if (queue.nowPlaying || (queue.upcoming && queue.upcoming.length > 0)) return null;
        return {
          nowPlaying: { ...newSong, positionMs: 0, positionAnchoredAt: now, isPaused: false },
          upcoming: [],
        };
      });

      if (!written.nowPlaying) {
        return res.json({ filled: false, reason: 'Queue was filled by another request' });
      }

      logEvent({ venueCode, action: 'autofill', songId: newSong.id, detail: `"${newSong.title}" autofilled` });
      broadcast.broadcastQueue(venueCode, written);
      res.json({ filled: true, song: newSong });
    } catch (err) {
      console.error('Autofill error:', err);
      res.status(500).json({ error: 'Failed to autofill queue' });
    }
  });
}

module.exports = {
  serverAutofill,
  autofillIfQueueEmpty,
  attachAutofillRoutes,
};
