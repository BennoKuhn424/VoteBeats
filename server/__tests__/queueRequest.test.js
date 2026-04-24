/**
 * HTTP-level tests for the song request, skip, advance, and remove-song routes.
 *
 * database, queueRepo, and broadcast are mocked so tests run without I/O and
 * without a real Socket.IO instance.
 */

jest.mock('../utils/database');
jest.mock('../repos/queueRepo');
jest.mock('../utils/broadcast');
jest.mock('../utils/logEvent', () => ({ logEvent: jest.fn() }));
// Prevent Apple Music / Yoco calls from reaching the network
jest.mock('../routes/queueAutofill', () => ({
  serverAutofill: jest.fn().mockResolvedValue(undefined),
  autofillIfQueueEmpty: jest.fn(),
  attachAutofillRoutes: jest.fn((router) => router),
}));
jest.mock('../utils/paymentFulfill', () => ({ fulfillPaidRequest: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../utils/yoco', () => ({
  verifyCheckoutWithYoco: jest.fn().mockResolvedValue({ verified: false }),
  verifyYocoWebhookSignature: jest.fn().mockReturnValue(true),
}));
jest.mock('../utils/appleMusicToken', () => ({ getToken: jest.fn().mockResolvedValue('mock-token') }));

const request = require('supertest');
const jwt = require('jsonwebtoken');
const db = require('../utils/database');
const queueRepo = require('../repos/queueRepo');
const { app } = require('../app');

// ── Fixtures ──────────────────────────────────────────────────────────────────
const VENUE_CODE = 'TSTV01';
const DEVICE_ID = 'device_test_abc123';
const JWT_SECRET = process.env.JWT_SECRET || 'speeldit-dev-secret-change-in-production';

const TEST_VENUE = {
  code: VENUE_CODE,
  name: 'Test Venue',
  settings: {
    requirePaymentForRequest: false,
    maxSongsPerUser: 3,
    autoplayQueue: false,
    autoplayMode: 'off',
  },
};

const EMPTY_QUEUE = { nowPlaying: null, upcoming: [] };

function makeSong(overrides = {}) {
  return {
    appleId: '123456789',
    title: 'Test Song',
    artist: 'Test Artist',
    albumArt: 'https://example.com/art.jpg',
    duration: 210,
    ...overrides,
  };
}

function venueJwt(venueCode, csrf = 'csrf-test') {
  return jwt.sign({ venueCode, csrf, jti: `jti-${venueCode}` }, JWT_SECRET, { expiresIn: '7d' });
}

function authedPost(path) {
  return request(app)
    .post(path)
    .set('Cookie', `auth_token=${venueJwt(VENUE_CODE)}`)
    .set('X-CSRF-Token', 'csrf-test');
}

beforeEach(() => {
  jest.resetAllMocks();
  db.getVenue.mockReturnValue(TEST_VENUE);
  db.getAllVenues.mockReturnValue({ [VENUE_CODE]: TEST_VENUE });
  db.getSubscription.mockReturnValue({ status: 'active' });
  db.getVotesForDevice.mockReturnValue({});
  db.getPlayerVolumeReport.mockReturnValue(null);
  db.recordAnalyticsEvent.mockImplementation(() => {});
  queueRepo.get.mockReturnValue(EMPTY_QUEUE);
  queueRepo.update.mockImplementation(async (_code, mutateFn) => {
    const current = queueRepo.get(_code);
    const result = mutateFn(current);
    return result !== null && result !== undefined ? result : current;
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// GET /api/queue/:venueCode
// ══════════════════════════════════════════════════════════════════════════════
describe('GET /api/queue/:venueCode', () => {
  test('returns 200 with empty queue for a venue with no songs', async () => {
    const res = await request(app).get(`/api/queue/${VENUE_CODE}`);
    expect(res.status).toBe(200);
    expect(res.body.nowPlaying).toBeNull();
    expect(res.body.upcoming).toEqual([]);
  });

  test('does not mutate queue state from a read request', async () => {
    queueRepo.get.mockReturnValue({
      nowPlaying: { id: 'old', appleId: 'old', title: 'Old Song', duration: 1, positionMs: 120000, positionAnchoredAt: Date.now() - 120000 },
      upcoming: [{ id: 'next', appleId: 'next', title: 'Next Song' }],
    });
    const res = await request(app).get(`/api/queue/${VENUE_CODE}`);
    expect(res.status).toBe(200);
    expect(queueRepo.update).not.toHaveBeenCalled();
    expect(require('../utils/broadcast').broadcastQueue).not.toHaveBeenCalled();
    expect(require('../routes/queueAutofill').serverAutofill).not.toHaveBeenCalled();
  });

  test('includes requestSettings in response', async () => {
    const res = await request(app).get(`/api/queue/${VENUE_CODE}`);
    expect(res.status).toBe(200);
    expect(res.body.requestSettings).toBeDefined();
    expect(typeof res.body.requestSettings.requirePaymentForRequest).toBe('boolean');
  });

  test('includes myVotes when deviceId query param is provided', async () => {
    db.getVotesForDevice.mockReturnValue({ song_1: 1, song_2: -1 });
    const res = await request(app)
      .get(`/api/queue/${VENUE_CODE}`)
      .query({ deviceId: DEVICE_ID });
    expect(res.status).toBe(200);
    expect(res.body.myVotes).toEqual({ song_1: 1, song_2: -1 });
  });

  test('returns 500 when an internal error occurs', async () => {
    queueRepo.get.mockImplementation(() => { throw new Error('disk full'); });
    const res = await request(app).get(`/api/queue/${VENUE_CODE}`);
    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/could not read queue/i);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// POST /api/queue/:venueCode/request
// ══════════════════════════════════════════════════════════════════════════════
describe('POST /api/queue/:venueCode/request — validation', () => {
  test('400 when song is missing entirely', async () => {
    const res = await request(app)
      .post(`/api/queue/${VENUE_CODE}/request`)
      .send({ deviceId: DEVICE_ID });
    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
  });

  test('400 when song.appleId is missing', async () => {
    const res = await request(app)
      .post(`/api/queue/${VENUE_CODE}/request`)
      .send({ song: { title: 'Song' }, deviceId: DEVICE_ID });
    expect(res.status).toBe(400);
  });

  test('400 when song.title is missing', async () => {
    const res = await request(app)
      .post(`/api/queue/${VENUE_CODE}/request`)
      .send({ song: { appleId: '123' }, deviceId: DEVICE_ID });
    expect(res.status).toBe(400);
  });

  test('400 when deviceId is missing', async () => {
    const res = await request(app)
      .post(`/api/queue/${VENUE_CODE}/request`)
      .send({ song: makeSong() });
    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
  });

  test('400 when deviceId exceeds 256 characters', async () => {
    const res = await request(app)
      .post(`/api/queue/${VENUE_CODE}/request`)
      .send({ song: makeSong(), deviceId: 'x'.repeat(257) });
    expect(res.status).toBe(400);
  });

  test('400 when song title is over 500 characters', async () => {
    const res = await request(app)
      .post(`/api/queue/${VENUE_CODE}/request`)
      .send({ song: makeSong({ title: 'a'.repeat(501) }), deviceId: DEVICE_ID });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/too long/i);
  });

  test('404 when venue does not exist', async () => {
    db.getVenue.mockReturnValue(null);
    const res = await request(app)
      .post(`/api/queue/${VENUE_CODE}/request`)
      .send({ song: makeSong(), deviceId: DEVICE_ID });
    expect(res.status).toBe(404);
  });

  test('402 when venue requires payment', async () => {
    db.getVenue.mockReturnValue({
      ...TEST_VENUE,
      settings: { ...TEST_VENUE.settings, requirePaymentForRequest: true, requestPriceCents: 1500 },
    });
    const res = await request(app)
      .post(`/api/queue/${VENUE_CODE}/request`)
      .send({ song: makeSong(), deviceId: DEVICE_ID });
    expect(res.status).toBe(402);
    expect(res.body.requiresPayment).toBe(true);
    expect(res.body.requestPriceCents).toBe(1500);
  });
});

describe('POST /api/queue/:venueCode/request — queue mutation', () => {
  test('song becomes nowPlaying when queue is empty', async () => {
    queueRepo.get.mockReturnValue(EMPTY_QUEUE);

    const res = await request(app)
      .post(`/api/queue/${VENUE_CODE}/request`)
      .send({ song: makeSong(), deviceId: DEVICE_ID });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    // Verify mutateFn set the song as nowPlaying
    const mutateFn = queueRepo.update.mock.calls[0][1];
    const result = mutateFn(EMPTY_QUEUE);
    expect(result.nowPlaying).toBeTruthy();
    expect(result.nowPlaying.appleId).toBe('123456789');
    expect(result.nowPlaying.positionMs).toBe(0);
    expect(result.nowPlaying.isPaused).toBe(false);
    expect(result.upcoming).toHaveLength(0);
  });

  test('song is added to upcoming when nowPlaying exists', async () => {
    const queueWithSong = {
      nowPlaying: { id: 's1', appleId: '999', title: 'Playing', requestedBy: 'other' },
      upcoming: [],
    };
    queueRepo.get.mockReturnValue(queueWithSong);

    const res = await request(app)
      .post(`/api/queue/${VENUE_CODE}/request`)
      .send({ song: makeSong(), deviceId: DEVICE_ID });

    expect(res.status).toBe(200);
    const mutateFn = queueRepo.update.mock.calls[0][1];
    const result = mutateFn(queueWithSong);
    expect(result.upcoming).toHaveLength(1);
    expect(result.upcoming[0].appleId).toBe('123456789');
  });

  test('400 when same song (by appleId) is already in queue', async () => {
    const queueWithSong = {
      nowPlaying: { id: 's1', appleId: '123456789', title: 'Test Song' },
      upcoming: [],
    };
    queueRepo.get.mockReturnValue(queueWithSong);
    queueRepo.update.mockImplementation(async (_code, mutateFn) => {
      mutateFn(queueWithSong); // Runs but sets rejection
      return queueWithSong;
    });

    const res = await request(app)
      .post(`/api/queue/${VENUE_CODE}/request`)
      .send({ song: makeSong(), deviceId: DEVICE_ID });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/already in the queue/i);
  });

  test('400 when user has hit maxSongsPerUser limit', async () => {
    const upcomingFull = [
      { id: 'a', appleId: 'a', title: 'A', requestedBy: DEVICE_ID },
      { id: 'b', appleId: 'b', title: 'B', requestedBy: DEVICE_ID },
      { id: 'c', appleId: 'c', title: 'C', requestedBy: DEVICE_ID },
    ];
    const fullQueue = { nowPlaying: { id: 'np', appleId: 'np', title: 'Playing', requestedBy: 'other' }, upcoming: upcomingFull };
    queueRepo.get.mockReturnValue(fullQueue);
    queueRepo.update.mockImplementation(async (_code, mutateFn) => {
      mutateFn(fullQueue);
      return fullQueue;
    });

    const res = await request(app)
      .post(`/api/queue/${VENUE_CODE}/request`)
      .send({ song: makeSong({ appleId: 'brand-new' }), deviceId: DEVICE_ID });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/max/i);
  });

  test('500 on unexpected queueRepo error', async () => {
    queueRepo.update.mockRejectedValue(new Error('disk full'));
    const res = await request(app)
      .post(`/api/queue/${VENUE_CODE}/request`)
      .send({ song: makeSong(), deviceId: DEVICE_ID });
    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/could not add song/i);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// POST /api/queue/:venueCode/advance
// ══════════════════════════════════════════════════════════════════════════════
describe('POST /api/queue/:venueCode/advance', () => {
  test('400 when songId is missing', async () => {
    const res = await authedPost(`/api/queue/${VENUE_CODE}/advance`)
      .send({});
    expect(res.status).toBe(400);
  });

  test('200 no-op when nowPlaying has already changed (race guard)', async () => {
    queueRepo.get.mockReturnValue({
      nowPlaying: { id: 's2', appleId: 'ap2', title: 'New song' },
      upcoming: [],
    });
    const res = await authedPost(`/api/queue/${VENUE_CODE}/advance`)
      .send({ songId: 's1' }); // stale — server is already on s2
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  test('500 on unexpected error', async () => {
    queueRepo.get.mockReturnValue({ nowPlaying: { id: 'target' }, upcoming: [] });
    queueRepo.update.mockRejectedValue(new Error('mutex error'));
    const res = await authedPost(`/api/queue/${VENUE_CODE}/advance`)
      .send({ songId: 'target' });
    expect(res.status).toBe(500);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// POST /api/queue/:venueCode/playing and /pause
// ══════════════════════════════════════════════════════════════════════════════
describe('POST /api/queue/:venueCode/playing', () => {
  test('200 success when songId matches nowPlaying', async () => {
    queueRepo.get.mockReturnValue({
      nowPlaying: { id: 's1', appleId: 'ap1', title: 'Song' },
      upcoming: [],
    });
    const res = await authedPost(`/api/queue/${VENUE_CODE}/playing`)
      .send({ songId: 's1', positionSeconds: 30 });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  test('500 on unexpected queueRepo error', async () => {
    queueRepo.update.mockRejectedValue(new Error('boom'));
    const res = await authedPost(`/api/queue/${VENUE_CODE}/playing`)
      .send({ songId: 's1', positionSeconds: 30 });
    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/could not update playback/i);
  });
});

describe('POST /api/queue/:venueCode/pause', () => {
  test('200 success when songId matches nowPlaying', async () => {
    queueRepo.get.mockReturnValue({
      nowPlaying: { id: 's1', appleId: 'ap1', title: 'Song', positionMs: 0, positionAnchoredAt: Date.now(), isPaused: false },
      upcoming: [],
    });
    const res = await authedPost(`/api/queue/${VENUE_CODE}/pause`)
      .send({ songId: 's1' });
    expect(res.status).toBe(200);
  });

  test('500 on unexpected queueRepo error', async () => {
    queueRepo.update.mockRejectedValue(new Error('boom'));
    const res = await authedPost(`/api/queue/${VENUE_CODE}/pause`)
      .send({ songId: 's1' });
    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/could not pause/i);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Volume feedback
// ══════════════════════════════════════════════════════════════════════════════
describe('POST /api/queue/:venueCode/volume-feedback', () => {
  test('400 when direction is invalid', async () => {
    const res = await request(app)
      .post(`/api/queue/${VENUE_CODE}/volume-feedback`)
      .send({ direction: 'way_too_loud', deviceId: DEVICE_ID });
    expect(res.status).toBe(400);
  });

  test('400 when deviceId is missing', async () => {
    const res = await request(app)
      .post(`/api/queue/${VENUE_CODE}/volume-feedback`)
      .send({ direction: 'too_loud' });
    expect(res.status).toBe(400);
  });

  test('200 for valid too_loud feedback', async () => {
    const res = await request(app)
      .post(`/api/queue/${VENUE_CODE}/volume-feedback`)
      .send({ direction: 'too_loud', deviceId: DEVICE_ID });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});
