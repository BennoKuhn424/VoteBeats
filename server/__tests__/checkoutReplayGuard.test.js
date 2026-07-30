/**
 * @jest-environment node
 *
 * Real-DB tests for the one-shot claim on non-song purchases.
 *
 * AI playlist generation is paid for with a normal provider checkout, and the
 * redemption route deleted the pending_payments row as soon as it delivered.
 * That row was the ONLY thing standing between a paid receipt and a replay —
 * and it is exactly the wrong thing to rely on, because the provider keeps
 * answering "this checkout is paid" forever. Once the row was gone the route
 * fell through to its no-pending branch, which verifies the checkout (still
 * paid), takes `count` from the request body, and generates again. One R25
 * payment could therefore mint unlimited 400-song playlists.
 *
 * `claimCheckout` is the durable "already spent" record that closes it.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

let db;
let sqlite;
let tmpDir;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vb-claim-'));
  process.env.DATA_DIR = tmpDir;
  db = require('../utils/database');
  sqlite = require('../utils/sqlite');
});

afterAll(() => {
  try {
    sqlite.closeForTest?.();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // Windows sometimes holds the file handle; the temp dir is disposable.
  }
});

describe('claimCheckout', () => {
  test('only the first claim on a checkout succeeds', () => {
    expect(db.claimCheckout('chk_once', 'playlist_generation', 'CLAIM1')).toBe(true);
    expect(db.claimCheckout('chk_once', 'playlist_generation', 'CLAIM1')).toBe(false);
    expect(db.claimCheckout('chk_once', 'playlist_generation', 'CLAIM1')).toBe(false);
  });

  test('a claim by a different venue cannot steal an already-spent checkout', () => {
    expect(db.claimCheckout('chk_steal', 'playlist_generation', 'CLAIM1')).toBe(true);
    expect(db.claimCheckout('chk_steal', 'playlist_generation', 'OTHER1')).toBe(false);
  });

  test('isCheckoutConsumed reports the claim', () => {
    expect(db.isCheckoutConsumed('chk_probe')).toBe(false);
    db.claimCheckout('chk_probe', 'playlist_generation', 'CLAIM1');
    expect(db.isCheckoutConsumed('chk_probe')).toBe(true);
  });

  test('the claim survives deletion of the pending row', () => {
    db.setPendingPayment('chk_durable', {
      kind: 'playlist_generation',
      venueCode: 'CLAIM1',
      playlistId: 'pl_1',
      amountCents: 2500,
      count: 25,
      prompt: 'jazz',
    });
    db.claimCheckout('chk_durable', 'playlist_generation', 'CLAIM1');
    db.removePendingPayment('chk_durable');

    // This is the replay: pending row gone, provider would still say "paid".
    expect(db.getPendingPayment('chk_durable')).toBeNull();
    expect(db.isCheckoutConsumed('chk_durable')).toBe(true);
    expect(db.claimCheckout('chk_durable', 'playlist_generation', 'CLAIM1')).toBe(false);
  });

  test('distinct checkouts are claimed independently', () => {
    expect(db.claimCheckout('chk_a', 'playlist_generation', 'CLAIM1')).toBe(true);
    expect(db.claimCheckout('chk_b', 'playlist_generation', 'CLAIM1')).toBe(true);
  });
});

// The song budget when the pending row is gone (the client names its own
// `count`, so it must be re-derived from what was actually paid) is a property
// of the route, not of this layer — it is tested through the real request in
// playlistGenerationRoute.test.js.

describe('releaseCheckoutClaim', () => {
  // The claim is taken BEFORE the slow generation work, because that is the
  // only ordering that makes concurrent redemptions safe. The cost is that a
  // generation which fails would otherwise leave the venue holding a receipt it
  // paid for and can never spend.
  test('releasing makes the checkout claimable again', () => {
    expect(db.claimCheckout('chk_rel', 'playlist_generation', 'CLAIM1')).toBe(true);
    expect(db.releaseCheckoutClaim('chk_rel')).toBe(true);

    expect(db.isCheckoutConsumed('chk_rel')).toBe(false);
    expect(db.claimCheckout('chk_rel', 'playlist_generation', 'CLAIM1')).toBe(true);
  });

  test('releasing an unclaimed checkout is a harmless no-op', () => {
    expect(db.releaseCheckoutClaim('chk_never_claimed')).toBe(false);
  });

  test('releasing one checkout does not free another', () => {
    db.claimCheckout('chk_keep', 'playlist_generation', 'CLAIM1');
    db.claimCheckout('chk_drop', 'playlist_generation', 'CLAIM1');

    db.releaseCheckoutClaim('chk_drop');

    expect(db.isCheckoutConsumed('chk_keep')).toBe(true);
    expect(db.isCheckoutConsumed('chk_drop')).toBe(false);
  });
});

/**
 * A checkout can be orphaned, resolved, and then orphaned AGAIN — the venue
 * retries a failed generation and it fails a second time. With INSERT OR
 * IGNORE the second orphan hit the existing resolved row and disappeared:
 * money owed a second time, displayed as settled.
 */
describe('orphaned payments re-open on a repeat failure', () => {
  const unresolved = () =>
    db.getOrphanedPayments().filter((o) => o.checkoutId === 'chk_twice');

  test('re-recording a resolved orphan surfaces it again', () => {
    db.recordOrphanedPayment({
      checkoutId: 'chk_twice', venueCode: 'CLAIM1', amountCents: 2500, reason: 'playlist_generation_failed',
    });
    expect(db.resolveOrphanedPayment('chk_twice', 'venue retried')).toBe(true);
    expect(unresolved()).toHaveLength(0);

    // The retry failed too — the money is owed again.
    db.recordOrphanedPayment({
      checkoutId: 'chk_twice', venueCode: 'CLAIM1', amountCents: 2500, reason: 'playlist_generation_failed',
    });

    expect(unresolved()).toHaveLength(1);
    expect(unresolved()[0].resolvedNote).toBe('');
  });

  test('the original created_at is preserved, so the age is not reset', () => {
    db.recordOrphanedPayment({
      checkoutId: 'chk_age', venueCode: 'CLAIM1', amountCents: 1000, reason: 'amount_mismatch',
    });
    const first = db.getOrphanedPayments().find((o) => o.checkoutId === 'chk_age');

    db.resolveOrphanedPayment('chk_age', 'settled');
    db.recordOrphanedPayment({
      checkoutId: 'chk_age', venueCode: 'CLAIM1', amountCents: 1000, reason: 'playlist_generation_failed',
    });
    const again = db.getOrphanedPayments().find((o) => o.checkoutId === 'chk_age');

    expect(again.createdAt).toBe(first.createdAt);
    expect(again.reason).toBe('playlist_generation_failed');
  });

  test('a single orphan is not duplicated by repeated records', () => {
    db.recordOrphanedPayment({ checkoutId: 'chk_dupe', venueCode: 'CLAIM1', amountCents: 500, reason: 'fulfil_failed' });
    db.recordOrphanedPayment({ checkoutId: 'chk_dupe', venueCode: 'CLAIM1', amountCents: 500, reason: 'fulfil_failed' });

    expect(db.getOrphanedPayments().filter((o) => o.checkoutId === 'chk_dupe')).toHaveLength(1);
  });
});
