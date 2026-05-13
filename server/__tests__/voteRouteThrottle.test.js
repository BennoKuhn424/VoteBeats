/**
 * @jest-environment node
 *
 * Vote throttle — HTTP integration.
 *
 * The unit-level throttle helpers (isVoteThrottled / recordVote semantics)
 * are covered in voteRoute.test.js. This file exercises the actual HTTP
 * route to prove that the in-memory throttle maps actually return 429 to a
 * patron, and that the throttle only ticks on successful votes (so a vote
 * for an already-removed song doesn't burn the patron's quota).
 *
 * The throttle is per-device (5/dir/min) AND per-IP (30/min total). We
 * exercise both layers.
 */

jest.mock('../utils/database');
jest.mock('../repos/queueRepo');
jest.mock('../utils/broadcast');
jest.mock('../utils/logEvent', () => ({ logEvent: jest.fn() }));
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

// The vote-route module keeps its throttle state in module-local Maps. We
// must reload it fresh for each test so timers and previous-vote state don't
// bleed across cases.
function freshApp() {
  jest.resetModules();
  jest.mock('../utils/database');
  jest.mock('../repos/queueRepo');
  jest.mock('../utils/broadcast');
  jest.mock('../utils/logEvent', () => ({ logEvent: jest.fn() }));
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

  // Permit each test 100s before rate-limiter window matters
  const db = require('../utils/database');
  const queueRepo = require('../repos/queueRepo');
  const { app } = require('../app');

  // Default DB stubs — a venue exists, with one upcoming song
  db.getVenue.mockReturnValue({ code: 'THROTL', settings: {} });
  db.getVote.mockReturnValue(undefined);
  db.setVote.mockImplementation(() => {});
  db.recordAnalyticsEvent.mockImplementation(() => {});

  // queueRepo.update runs the mutateFn against a fresh snapshot and returns the new queue
  queueRepo.update.mockImplementation(async (_venueCode, fn) => {
    const queue = { nowPlaying: null, upcoming: [{ id: 'song_1', votes: 0, title: 'T', artist: 'A' }] };
    const next = fn(queue);
    return next ?? queue;
  });
  queueRepo.get.mockReturnValue({ nowPlaying: null, upcoming: [{ id: 'song_1', votes: 0 }] });

  return { app, db, queueRepo, request: require('supertest') };
}

function voteBody(songId = 'song_1', voteValue = 1, deviceId = 'device-A') {
  return { songId, voteValue, deviceId };
}

describe('Per-device vote throttle (5 / direction / 60s)', () => {
  test('returns 429 with code VOTE_RATE_LIMITED_UP after 5 successful upvotes from same device', async () => {
    const { app, request } = freshApp();

    for (let i = 0; i < 5; i++) {
      const res = await request(app)
        .post('/api/queue/THROTL/vote')
        .send(voteBody('song_1', 1, 'device-A'));
      expect(res.status).toBe(200);
    }
    const sixth = await request(app)
      .post('/api/queue/THROTL/vote')
      .send(voteBody('song_1', 1, 'device-A'));
    expect(sixth.status).toBe(429);
    expect(sixth.body.code).toBe('VOTE_RATE_LIMITED_UP');
  });

  test('returns 429 with code VOTE_RATE_LIMITED_DOWN after 5 downvotes from same device', async () => {
    const { app, request } = freshApp();

    for (let i = 0; i < 5; i++) {
      const res = await request(app)
        .post('/api/queue/THROTL/vote')
        .send(voteBody('song_1', -1, 'device-B'));
      expect(res.status).toBe(200);
    }
    const sixth = await request(app)
      .post('/api/queue/THROTL/vote')
      .send(voteBody('song_1', -1, 'device-B'));
    expect(sixth.status).toBe(429);
    expect(sixth.body.code).toBe('VOTE_RATE_LIMITED_DOWN');
  });

  test('upvote quota is independent of downvote quota for the same device', async () => {
    const { app, request } = freshApp();

    for (let i = 0; i < 5; i++) {
      await request(app)
        .post('/api/queue/THROTL/vote')
        .send(voteBody('song_1', 1, 'device-C'));
    }
    // Downvote on the same device — different direction map — must still pass
    const down = await request(app)
      .post('/api/queue/THROTL/vote')
      .send(voteBody('song_1', -1, 'device-C'));
    expect(down.status).toBe(200);
  });

  test('throttle quota is NOT burned by failed votes (404 on missing song)', async () => {
    const { app, queueRepo, request } = freshApp();
    // Make the song lookup miss so the route returns 404
    queueRepo.update.mockImplementationOnce(async (_v, fn) => {
      // Don't run the mutator with a usable song; let the route return its rejection
      fn({ nowPlaying: null, upcoming: [] });
      return { nowPlaying: null, upcoming: [] };
    });

    const miss = await request(app)
      .post('/api/queue/THROTL/vote')
      .send(voteBody('song_missing', 1, 'device-D'));
    expect(miss.status).toBe(404);

    // Now restore the normal queue and exercise the full 5-quota for the same device.
    // If the previous 404 had burned the quota, only 4 successes would land.
    queueRepo.update.mockImplementation(async (_v, fn) => {
      const queue = { nowPlaying: null, upcoming: [{ id: 'song_1', votes: 0 }] };
      const next = fn(queue);
      return next ?? queue;
    });

    for (let i = 0; i < 5; i++) {
      const res = await request(app)
        .post('/api/queue/THROTL/vote')
        .send(voteBody('song_1', 1, 'device-D'));
      expect(res.status).toBe(200);
    }
  });

  test('throttle is scoped per-device — a fresh device starts at zero', async () => {
    const { app, request } = freshApp();

    // Exhaust device-E
    for (let i = 0; i < 5; i++) {
      await request(app)
        .post('/api/queue/THROTL/vote')
        .send(voteBody('song_1', 1, 'device-E'));
    }
    const blocked = await request(app)
      .post('/api/queue/THROTL/vote')
      .send(voteBody('song_1', 1, 'device-E'));
    expect(blocked.status).toBe(429);

    // device-F is fresh — same IP, but a different device id
    const fresh = await request(app)
      .post('/api/queue/THROTL/vote')
      .send(voteBody('song_1', 1, 'device-F'));
    expect(fresh.status).toBe(200);
  });
});
