/**
 * @jest-environment node
 *
 * Real-DB tests for the payment ledger's money-safety guarantees.
 *
 * `addPayment` used to build its row id as `pay_${Date.now()}_${checkoutId}`,
 * which is unique per *call*, not per checkout — so the primary key did not
 * stop the same checkout being credited twice. There was also no way to trace
 * a payment row back to the checkout that produced it. Both are fixed by a
 * checkout_id column with a UNIQUE index; these tests pin that.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

let db;
let sqlite;
let tmpDir;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vb-payidem-'));
  process.env.DATA_DIR = tmpDir;
  db = require('../utils/database');
  sqlite = require('../utils/sqlite');
  db.saveVenue('IDEM01', { code: 'IDEM01', name: 'Idem Bar', settings: {} });
});

afterAll(() => {
  try {
    sqlite.close?.();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // Windows sometimes holds the file handle; the temp dir is disposable.
  }
});

describe('addPayment idempotency', () => {
  test('crediting the same checkout twice only books it once', () => {
    const first = db.addPayment('IDEM01', 3000, 'chk_dup');
    const second = db.addPayment('IDEM01', 3000, 'chk_dup');

    expect(first).toBe(true);
    expect(second).toBe(false);

    const now = new Date();
    const earnings = db.getVenueEarningsForMonth('IDEM01', now.getFullYear(), now.getMonth() + 1);
    const forCheckout = earnings.payments.filter((p) => p.amountCents === 3000);
    expect(forCheckout).toHaveLength(1);
  });

  test('distinct checkouts are booked separately', () => {
    expect(db.addPayment('IDEM01', 1111, 'chk_a')).toBe(true);
    expect(db.addPayment('IDEM01', 1111, 'chk_b')).toBe(true);

    expect(db.getPaymentByCheckout('chk_a')).not.toBeNull();
    expect(db.getPaymentByCheckout('chk_b')).not.toBeNull();
  });

  test('a payment can be traced back to its checkout', () => {
    db.addPayment('IDEM01', 4200, 'chk_trace');
    const found = db.getPaymentByCheckout('chk_trace');

    expect(found).toMatchObject({
      venueCode: 'IDEM01',
      amountCents: 4200,
      checkoutId: 'chk_trace',
    });
  });

  test('unknown checkout returns null rather than throwing', () => {
    expect(db.getPaymentByCheckout('chk_nope')).toBeNull();
  });

  test('legacy rows without a checkout id do not collide', () => {
    // The UNIQUE index is partial (WHERE checkout_id IS NOT NULL) so historical
    // rows written before the column existed remain valid.
    expect(db.addPayment('IDEM01', 700, null)).toBe(true);
    expect(db.addPayment('IDEM01', 800, null)).toBe(true);
  });
});

describe('orphaned payments ledger', () => {
  test('records money that could not be booked, then resolves it', () => {
    db.recordOrphanedPayment({
      checkoutId: 'chk_orphan_1',
      venueCode: 'IDEM01',
      amountCents: 2500,
      reason: 'amount_mismatch',
      detail: { expectedCents: 3000, providerCents: 2500 },
    });

    const unresolved = db.getOrphanedPayments();
    const found = unresolved.find((o) => o.checkoutId === 'chk_orphan_1');
    expect(found).toMatchObject({
      reason: 'amount_mismatch',
      amountCents: 2500,
      amountRand: '25.00',
      resolved: false,
    });
    expect(found.detail).toEqual({ expectedCents: 3000, providerCents: 2500 });

    expect(db.resolveOrphanedPayment('chk_orphan_1', 'refunded via Yoco dashboard')).toBe(true);
    expect(db.getOrphanedPayments().some((o) => o.checkoutId === 'chk_orphan_1')).toBe(false);

    const withResolved = db.getOrphanedPayments({ includeResolved: true });
    expect(withResolved.find((o) => o.checkoutId === 'chk_orphan_1')).toMatchObject({
      resolved: true,
      resolvedNote: 'refunded via Yoco dashboard',
    });
  });

  test('recording the same orphan twice does not duplicate it', () => {
    db.recordOrphanedPayment({ checkoutId: 'chk_orphan_2', venueCode: 'IDEM01', amountCents: 100, reason: 'fulfil_failed' });
    db.recordOrphanedPayment({ checkoutId: 'chk_orphan_2', venueCode: 'IDEM01', amountCents: 100, reason: 'fulfil_failed' });

    const matches = db.getOrphanedPayments().filter((o) => o.checkoutId === 'chk_orphan_2');
    expect(matches).toHaveLength(1);
  });

  test('resolving an unknown orphan reports failure', () => {
    expect(db.resolveOrphanedPayment('chk_missing', 'note')).toBe(false);
  });
});
