const express = require('express');
const db = require('../utils/database');
const E = require('../utils/errorCodes');
const { v4: uuidv4 } = require('uuid');
const authMiddleware = require('../middleware/authMiddleware');
const { advanceToNextSong } = require('../utils/queueAdvance');
const broadcast = require('../utils/broadcast');
const { logEvent } = require('../utils/logEvent');
const queueRepo = require('../repos/queueRepo');
const { serverAutofill, autofillIfQueueEmpty, attachAutofillRoutes } = require('./queueAutofill');
const attachVoteRoutes = require('./queueVote');
const attachPaymentRoutes = require('./queuePayment');
const validate = require('../middleware/validate');
const {
  requestSongSchema,
  songIdSchema,
  playingSchema,
  volumeReportSchema,
  volumeFeedbackSchema,
} = require('../utils/schemas');

const validateVenueCode = require('../middleware/validateVenueCode');

const router = express.Router();
router.param('venueCode', validateVenueCode);

// ── Anchor-pattern helper ─────────────────────────────────────────────────────
function getCurrentPositionMs(np) {
  if (!np) return 0;
  const posMs = np.positionMs ?? 0;
  const anchoredAt = np.positionAnchoredAt ?? np.startedAt ?? Date.now();
  if (np.isPaused || np.pausedAt) return posMs;
  return posMs + (Date.now() - anchoredAt);
}

// Customer volume feedback — per device cooldown (spam prevention)
const volumeFeedbackLastByDevice = new Map();
const VOLUME_FEEDBACK_MAX_ENTRIES = 10_000;
const VOLUME_FEEDBACK_COOLDOWN_MS = 90 * 1000;
const VOLUME_REPORT_MAX_AGE_MS = 30 * 60 * 1000;

// POST /api/queue/:venueCode/report-volume — venue player reports slider level (0–100)
router.post('/:venueCode/report-volume', validate(volumeReportSchema), (req, res) => {
  const { venueCode } = req.params;
  if (!db.getVenue(venueCode)) return res.status(404).json({ error: 'Venue not found', code: E.QUEUE_VENUE_NOT_FOUND });
  db.setPlayerVolumeReport(venueCode, req.body.volumePercent);
  res.json({ ok: true });
});

// POST /api/queue/:venueCode/volume-feedback — customer: too loud / too soft
router.post('/:venueCode/volume-feedback', validate(volumeFeedbackSchema), (req, res) => {
  const { venueCode } = req.params;
  const { direction, deviceId } = req.body;
  if (!db.getVenue(venueCode)) return res.status(404).json({ error: 'Venue not found', code: E.QUEUE_VENUE_NOT_FOUND });

  const key = `${venueCode}:${deviceId}`;
  const now = Date.now();
  const last = volumeFeedbackLastByDevice.get(key) || 0;
  if (now - last < VOLUME_FEEDBACK_COOLDOWN_MS) {
    return res.status(429).json({ error: 'Please wait a minute before sending another suggestion', code: E.QUEUE_RATE_LIMITED });
  }
  if (volumeFeedbackLastByDevice.size > VOLUME_FEEDBACK_MAX_ENTRIES) {
    const iter = volumeFeedbackLastByDevice.keys();
    for (let i = 0; i < 1000; i++) volumeFeedbackLastByDevice.delete(iter.next().value);
  }
  volumeFeedbackLastByDevice.set(key, now);

  const report = db.getPlayerVolumeReport(venueCode);
  let volumePercent = null;
  let volumeStale = true;
  if (report && typeof report.percent === 'number') {
    volumePercent = report.percent;
    volumeStale = now - (report.updatedAt || 0) > VOLUME_REPORT_MAX_AGE_MS;
  }

  db.recordAnalyticsEvent(venueCode, {
    type: 'volumeFeedback',
    direction,
    volumePercent,
    volumeStale,
    deviceId: deviceId.slice(0, 64),
  });

  const payload = {
    direction,
    volumePercent,
    volumeStale,
    at: now,
  };
  broadcast.broadcastVolumeFeedback(venueCode, payload);
  logEvent({ venueCode, action: 'volume_feedback', detail: direction });

  res.json({ success: true, volumePercent, volumeStale });
});

// GET /api/queue/:venueCode?deviceId=xxx
router.get('/:venueCode', async (req, res) => {
  try {
    const { venueCode } = req.params;
    const { deviceId } = req.query;
    let queue = queueRepo.get(venueCode);
    const venue = db.getVenue(venueCode);

    const np = queue.nowPlaying;
    if (np && !np.isPaused && !np.pausedAt) {
      let durationMs = (np.duration || 0) * 1000;
      if (durationMs < 30000) durationMs = 600000;
      const currentPos = getCurrentPositionMs(np);
      if (currentPos >= durationMs + 10000) {
        queue = await advanceToNextSong(venueCode, np.id);
        broadcast.broadcastQueue(venueCode, queue);
        if (!queue.nowPlaying) {
          const s = venue?.settings;
          if (s?.autoplayMode !== 'off' && s?.autoplayQueue !== false) {
            serverAutofill(venueCode, venue).catch((err) => console.error('Autofill error:', err));
          }
        }
      }
    }

    let myVotes = {};
    if (deviceId) {
      const votes = db.getVotesForDevice(venueCode, deviceId);
      myVotes = votes || {};
    }

    const autoplayGenre = venue?.settings?.autoplayGenre;
    const hasAutoplayGenre = Array.isArray(autoplayGenre) ? autoplayGenre.length > 0 : !!autoplayGenre;

    const requestSettings = venue?.settings
      ? {
          requirePaymentForRequest: venue.settings.requirePaymentForRequest ?? false,
          requestPriceCents: venue.settings.requestPriceCents ?? 1000,
          autoplayQueue: venue.settings.autoplayQueue ?? true,
          hasAutoplayGenre,
        }
      : { requirePaymentForRequest: false, requestPriceCents: 1000, autoplayQueue: true, hasAutoplayGenre: false };

    const volReport = db.getPlayerVolumeReport(venueCode);
    const reportedPlayerVolume =
      volReport && typeof volReport.percent === 'number'
        ? {
            percent: volReport.percent,
            stale: Date.now() - (volReport.updatedAt || 0) > VOLUME_REPORT_MAX_AGE_MS,
          }
        : null;

    res.json({ ...queue, myVotes, requestSettings, reportedPlayerVolume });
  } catch (err) {
    console.error('Queue read error on GET /:venueCode:', err);
    res.status(500).json({ error: 'Could not read queue', code: E.QUEUE_READ_FAILED });
  }
});

// POST /api/queue/:venueCode/request
router.post('/:venueCode/request', validate(requestSongSchema), async (req, res) => {
  const { venueCode } = req.params;
  const { song, deviceId } = req.body;

  const venue = db.getVenue(venueCode);
  if (!venue) {
    return res.status(404).json({ error: 'Venue not found', code: E.QUEUE_VENUE_NOT_FOUND });
  }

  if (venue.settings?.requirePaymentForRequest) {
    return res.status(402).json({
      error: 'Payment required to request a song',
      code: E.QUEUE_PAYMENT_REQUIRED,
      requiresPayment: true,
      requestPriceCents: venue.settings.requestPriceCents ?? 1000,
    });
  }

  const songId = song.id || song.appleId;
  const maxPerUser = venue.settings?.maxSongsPerUser ?? 3;

  const newSong = {
    ...song,
    id: song.id || `song_${uuidv4()}`,
    votes: 0,
    requestedBy: deviceId,
    requestedAt: Date.now(),
  };

  try {
    let rejection = null;
    const updated = await queueRepo.update(venueCode, (queue) => {
      const upcoming = queue.upcoming || [];
      const np = queue.nowPlaying;
      const alreadyNowPlaying = np && ((np.id && np.id === songId) || (np.appleId && np.appleId === song.appleId));
      const alreadyInQueue = alreadyNowPlaying || upcoming.some(
        (s) => (s.id && s.id === songId) || (s.appleId && s.appleId === song.appleId)
      );
      if (alreadyInQueue) {
        rejection = { status: 400, body: { error: 'This song is already in the queue', code: E.QUEUE_SONG_DUPLICATE } };
        return null;
      }
      if (upcoming.filter((s) => s.requestedBy === deviceId).length >= maxPerUser) {
        rejection = { status: 400, body: { error: `Max ${maxPerUser} songs per user`, code: E.QUEUE_USER_LIMIT_REACHED } };
        return null;
      }
      if (!queue.nowPlaying) {
        return {
          nowPlaying: { ...newSong, positionMs: 0, positionAnchoredAt: Date.now(), isPaused: false },
          upcoming,
        };
      }
      return { nowPlaying: queue.nowPlaying, upcoming: [...upcoming, newSong] };
    });

    if (rejection) {
      return res.status(rejection.status).json(rejection.body);
    }

    logEvent({ venueCode, action: 'request', songId: newSong.id, detail: `"${newSong.title}" added to queue` });
    db.recordAnalyticsEvent(venueCode, { type: 'request', songTitle: newSong.title, artist: newSong.artist, songId: newSong.id });
    broadcast.broadcastQueue(venueCode, updated);
    res.json({ success: true, song: newSong });
  } catch (err) {
    console.error('Queue write error on /request:', err);
    res.status(500).json({ error: 'Could not add song to queue — please try again', code: E.QUEUE_REQUEST_FAILED });
  }
});

attachVoteRoutes(router);

// POST /api/queue/:venueCode/playing
router.post('/:venueCode/playing', validate(playingSchema), async (req, res) => {
  try {
    const { venueCode } = req.params;
    const { songId, positionSeconds } = req.body;

    const updated = await queueRepo.update(venueCode, (queue) => {
      if (!queue.nowPlaying ||
          (queue.nowPlaying.id !== songId && String(queue.nowPlaying.appleId) !== String(songId))) {
        return null;
      }
      const pos = typeof positionSeconds === 'number' && positionSeconds > 0 ? positionSeconds : 0;
      const np = {
        ...queue.nowPlaying,
        positionMs: Math.round(pos * 1000),
        positionAnchoredAt: Date.now(),
        isPaused: false,
      };
      delete np.startedAt;
      delete np.pausedAt;
      return { ...queue, nowPlaying: np };
    });

    const matched = updated.nowPlaying?.id === songId ||
      String(updated.nowPlaying?.appleId) === String(songId);
    if (matched) broadcast.broadcastQueue(venueCode, updated);
    res.json({ success: true, matched });
  } catch (err) {
    console.error('Queue write error on /playing:', err);
    res.status(500).json({ error: 'Could not update playback position', code: E.QUEUE_PLAYING_FAILED });
  }
});

// POST /api/queue/:venueCode/pause
router.post('/:venueCode/pause', validate(songIdSchema), async (req, res) => {
  try {
    const { venueCode } = req.params;
    const { songId } = req.body;

    const pre = queueRepo.get(venueCode);
    const frozenPos = pre.nowPlaying ? getCurrentPositionMs(pre.nowPlaying) : 0;

    const updated = await queueRepo.update(venueCode, (queue) => {
      if (!queue.nowPlaying ||
          (queue.nowPlaying.id !== songId && String(queue.nowPlaying.appleId) !== String(songId))) {
        return null;
      }
      const np = {
        ...queue.nowPlaying,
        positionMs: frozenPos,
        positionAnchoredAt: Date.now(),
        isPaused: true,
      };
      delete np.startedAt;
      delete np.pausedAt;
      return { ...queue, nowPlaying: np };
    });

    const matched = updated.nowPlaying?.id === songId ||
      String(updated.nowPlaying?.appleId) === String(songId);
    if (matched) broadcast.broadcastQueue(venueCode, updated);
    res.json({ success: true, matched });
  } catch (err) {
    console.error('Queue write error on /pause:', err);
    res.status(500).json({ error: 'Could not pause playback', code: E.QUEUE_PAUSE_FAILED });
  }
});

// POST /api/queue/:venueCode/advance
router.post('/:venueCode/advance', validate(songIdSchema), async (req, res) => {
  try {
    const { venueCode } = req.params;
    const { songId } = req.body;

    const currentSongId = queueRepo.get(venueCode).nowPlaying?.id ?? null;
    if (currentSongId !== songId) {
      return res.json({ success: true, nowPlaying: queueRepo.get(venueCode).nowPlaying || null });
    }

    let queue = await advanceToNextSong(venueCode, songId);
    logEvent({ venueCode, action: 'advance', songId, detail: 'song ended — advancing' });

    if (!queue.nowPlaying && (!queue.upcoming || queue.upcoming.length === 0)) {
      const venue = db.getVenue(venueCode);
      const s = venue?.settings;
      if (s?.autoplayMode !== 'off' && s?.autoplayQueue !== false) {
        await serverAutofill(venueCode, venue).catch((err) => console.error('Autofill error:', err));
        queue = queueRepo.get(venueCode);
      }
    }

    broadcast.broadcastQueue(venueCode, queue);
    res.json({ success: true, nowPlaying: queue.nowPlaying || null });
  } catch (err) {
    console.error('Queue write error on /advance:', err);
    res.status(500).json({ error: 'Could not advance queue', code: E.QUEUE_ADVANCE_FAILED });
  }
});

// POST /api/queue/:venueCode/skip (venue owner only)
router.post('/:venueCode/skip', authMiddleware, validate(songIdSchema), async (req, res) => {
  try {
    if (req.venue.code !== req.params.venueCode) {
      return res.status(403).json({ error: 'Unauthorized', code: E.QUEUE_SKIP_UNAUTHORIZED });
    }
    const { venueCode } = req.params;
    const { songId } = req.body;

    const currentSongId = queueRepo.get(venueCode).nowPlaying?.id;
    if (currentSongId && currentSongId !== songId) {
      return res.status(409).json({ error: 'Skip rejected — song already changed', code: E.QUEUE_SKIP_CONFLICT, currentSongId });
    }

    let queue = await advanceToNextSong(venueCode, songId);
    logEvent({ venueCode, action: 'skip', songId, detail: 'venue owner skipped song' });

    if (!queue.nowPlaying && (!queue.upcoming || queue.upcoming.length === 0)) {
      const venue = db.getVenue(venueCode);
      const s = venue?.settings;
      if (s?.autoplayMode !== 'off' && s?.autoplayQueue !== false) {
        await serverAutofill(venueCode, venue).catch((err) => console.error('Autofill error:', err));
        queue = queueRepo.get(venueCode);
      }
    }

    broadcast.broadcastQueue(venueCode, queue);
    res.json({ success: true });
  } catch (err) {
    console.error('Queue write error on /skip:', err);
    res.status(500).json({ error: 'Could not skip song', code: E.QUEUE_SKIP_FAILED });
  }
});

// DELETE /api/queue/:venueCode/song/:songId (venue owner only)
router.delete('/:venueCode/song/:songId', authMiddleware, async (req, res) => {
  try {
    const { venueCode, songId } = req.params;

    if (req.venue.code !== venueCode) {
      return res.status(403).json({ error: 'Unauthorized', code: E.QUEUE_REMOVE_UNAUTHORIZED });
    }

    const updated = await queueRepo.update(venueCode, (queue) => ({
      ...queue,
      upcoming: (queue.upcoming || []).filter((s) => s.id !== songId),
    }));
    broadcast.broadcastQueue(venueCode, updated);
    res.json({ success: true });
  } catch (err) {
    console.error('Queue write error on DELETE /song:', err);
    res.status(500).json({ error: 'Could not remove song from queue', code: E.QUEUE_REMOVE_FAILED });
  }
});

attachPaymentRoutes(router);
attachAutofillRoutes(router);

router.autofillIfQueueEmpty = autofillIfQueueEmpty;
module.exports = router;
