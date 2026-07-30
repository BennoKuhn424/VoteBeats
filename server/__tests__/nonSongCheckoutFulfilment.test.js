/**
 * @jest-environment node
 *
 * Real-DB tests for two money bugs in the paid-request fulfilment path.
 *
 * 1. pending_payments is shared by TWO kinds of purchase: a patron paying to
 *    queue a song, and a venue paying for AI playlist generation. Both create
 *    a checkout at the same provider, so both produce the same
 *    `payment.succeeded` webhook. Fulfilment treated every one of them as a
 *    song request, which meant each AI playlist purchase pushed a blank,
 *    title-less song into the venue's live queue AND booked the platform's
 *    generation fee as venue patron revenue — revenue the payout split then
 *    hands 70% of back to the venue.
 *
 * 2. The payment row was written AFTER the queue write. A failing queue write
 *    therefore threw with the pending row already deleted and no payment row
 *    ever created: the patron was charged and the money existed nowhere in the
 *    ledger, so no payout, no reconcile mismatch, nothing to find.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

let db;
let sqlite;
let queueRepo;
let fulfillPaidRequest;
let tmpDir;

const VENUE = 'FULFIL1';

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vb-fulfil-'));
  process.env.DATA_DIR = tmpDir;
  db = require('../utils/database');
  sqlite = require('../utils/sqlite');
  queueRepo = require('../repos/queueRepo');
  ({ fulfillPaidRequest } = require('../utils/paymentFulfill'));
  db.saveVenue(VENUE, { code: VENUE, name: 'Fulfil Bar', settings: { requestPriceCents: 1000 } });
});

afterAll(() => {
  try {
    sqlite.closeForTest?.();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // Windows sometimes holds the file handle; the temp dir is disposable.
  }
});

beforeEach(() => {
  sqlite.prepare('DELETE FROM queues WHERE venue_code = ?').run(VENUE);
  sqlite.prepare('DELETE FROM payments WHERE venue_code = ?').run(VENUE);
  sqlite.prepare('DELETE FROM pending_payments WHERE venue_code = ?').run(VENUE);
});

function earningsCents() {
  const now = new Date();
  return db.getVenueEarningsForMonth(VENUE, now.getFullYear(), now.getMonth() + 1).grossCents;
}

describe('fulfillPaidRequest — purchase kind', () => {
  test('an AI playlist-generation checkout is never queued or credited', async () => {
    db.setPendingPayment('chk_playlist', {
      kind: 'playlist_generation',
      venueCode: VENUE,
      playlistId: 'pl_1',
      amountCents: 2500,
      count: 25,
      prompt: 'sunday jazz',
    });

    const fulfilled = await fulfillPaidRequest('chk_playlist', 2500);

    expect(fulfilled).toBe(false);

    // No blank song injected into the venue's live queue.
    const queue = queueRepo.get(VENUE);
    expect(queue.nowPlaying).toBeNull();
    expect(queue.upcoming).toEqual([]);

    // The platform's fee was not booked as venue patron revenue.
    expect(earningsCents()).toBe(0);

    // The pending row survives so the venue can still redeem the generation.
    expect(db.getPendingPayment('chk_playlist')).not.toBeNull();
  });

  test('a genuine song request still fulfils normally', async () => {
    db.setPendingPayment('chk_song', {
      venueCode: VENUE,
      amountCents: 1500,
      deviceId: 'dev-1',
      song: { id: 'song_a', appleId: 'apple_a', title: 'Real Song', artist: 'Real Artist', duration: 180 },
    });

    const fulfilled = await fulfillPaidRequest('chk_song', 1500);

    expect(fulfilled).toBe(true);
    expect(queueRepo.get(VENUE).nowPlaying).toMatchObject({ id: 'song_a', title: 'Real Song' });
    expect(earningsCents()).toBe(1500);
    expect(db.getPendingPayment('chk_song')).toBeNull();
  });
});

describe('fulfillPaidRequest — money is recorded before the queue write', () => {
  test('a failing queue write still leaves the payment on the ledger', async () => {
    db.setPendingPayment('chk_boom', {
      venueCode: VENUE,
      amountCents: 3000,
      deviceId: 'dev-2',
      song: { id: 'song_b', appleId: 'apple_b', title: 'Boom', artist: 'Artist', duration: 200 },
    });

    const spy = jest.spyOn(queueRepo, 'update').mockRejectedValue(new Error('disk full'));
    try {
      await expect(fulfillPaidRequest('chk_boom', 3000)).rejects.toThrow('disk full');
    } finally {
      spy.mockRestore();
    }

    // The patron was charged, so the venue must still be credited even though
    // the song never made it into the queue.
    expect(earningsCents()).toBe(3000);
    expect(db.getPaymentByCheckout('chk_boom')).toMatchObject({
      venueCode: VENUE,
      amountCents: 3000,
    });
  });

  test('replaying the same checkout after a failure does not double-credit', async () => {
    db.setPendingPayment('chk_retry', {
      venueCode: VENUE,
      amountCents: 1000,
      deviceId: 'dev-3',
      song: { id: 'song_c', appleId: 'apple_c', title: 'Retry', artist: 'Artist', duration: 200 },
    });

    const spy = jest.spyOn(queueRepo, 'update').mockRejectedValueOnce(new Error('transient'));
    try {
      await expect(fulfillPaidRequest('chk_retry', 1000)).rejects.toThrow('transient');
    } finally {
      spy.mockRestore();
    }
    expect(earningsCents()).toBe(1000);

    // The pending row is gone, so a provider retry is a no-op — and even a
    // direct re-fulfil cannot book the money a second time.
    expect(await fulfillPaidRequest('chk_retry', 1000)).toBe(false);
    expect(earningsCents()).toBe(1000);
  });
});
