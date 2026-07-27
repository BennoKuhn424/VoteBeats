/**
 * @jest-environment node
 *
 * The ledger self-check catches silent corruption between the two money records
 * (payments rows vs payout rollups) before it becomes a wrong transfer. These
 * tests drive it with a fake DB so each failure mode is isolated.
 */

const { checkLedgerIntegrity } = require('../utils/ledgerIntegrity');

const NOW = new Date(2026, 6, 15); // July 2026 → checks back from June

function payout(over = {}) {
  return {
    id: 'po_1',
    venueCode: 'VEN001',
    grossCents: 5000,
    venueAmountCents: 3500,
    platformAmountCents: 1500,
    ...over,
  };
}

/** Fake DB: payouts keyed by "year-month", earnings keyed by "venue|year-month". */
function makeDb({ payouts = {}, earnings = {} } = {}) {
  return {
    getAllPayoutsForMonth: (y, m) => payouts[`${y}-${m}`] || [],
    getVenueEarningsForMonth: (v, y, m) => ({ grossCents: earnings[`${v}|${y}-${m}`] ?? 0 }),
  };
}

describe('checkLedgerIntegrity', () => {
  test('reports clean when payouts match the payment rows', () => {
    const database = makeDb({
      payouts: { '2026-6': [payout()] },
      earnings: { 'VEN001|2026-6': 5000 },
    });

    const result = checkLedgerIntegrity({ database, monthsBack: 1, now: NOW });

    expect(result.problems).toEqual([]);
    expect(result.checkedPayouts).toBe(1);
  });

  test('flags a split that does not sum to gross', () => {
    const database = makeDb({
      payouts: { '2026-6': [payout({ venueAmountCents: 3500, platformAmountCents: 1400 })] },
      earnings: { 'VEN001|2026-6': 5000 },
    });

    const result = checkLedgerIntegrity({ database, monthsBack: 1, now: NOW });

    expect(result.problems).toHaveLength(1);
    expect(result.problems[0].kind).toBe('split_mismatch');
  });

  test('flags gross that drifted from the underlying payments', () => {
    const database = makeDb({
      payouts: { '2026-6': [payout()] },
      earnings: { 'VEN001|2026-6': 4000 }, // payments say 4000, payout says 5000
    });

    const result = checkLedgerIntegrity({ database, monthsBack: 1, now: NOW });

    const drift = result.problems.find((p) => p.kind === 'gross_drift');
    expect(drift).toBeTruthy();
    expect(drift.detail).toEqual({ recordedGrossCents: 5000, actualGrossCents: 4000 });
  });

  test('flags negative amounts', () => {
    const database = makeDb({
      payouts: { '2026-6': [payout({ grossCents: -100, venueAmountCents: -70, platformAmountCents: -30 })] },
      earnings: { 'VEN001|2026-6': -100 },
    });

    const result = checkLedgerIntegrity({ database, monthsBack: 1, now: NOW });

    expect(result.problems.some((p) => p.kind === 'negative_amount')).toBe(true);
  });

  test('flags a duplicate payout for the same venue+month', () => {
    const database = makeDb({
      payouts: { '2026-6': [payout({ id: 'po_1' }), payout({ id: 'po_2' })] },
      earnings: { 'VEN001|2026-6': 5000 },
    });

    const result = checkLedgerIntegrity({ database, monthsBack: 1, now: NOW });

    expect(result.problems.some((p) => p.kind === 'duplicate_payout')).toBe(true);
  });

  test('never inspects the current (open) month', () => {
    const seen = [];
    const database = {
      getAllPayoutsForMonth: (y, m) => { seen.push(`${y}-${m}`); return []; },
      getVenueEarningsForMonth: () => ({ grossCents: 0 }),
    };

    checkLedgerIntegrity({ database, monthsBack: 3, now: NOW });

    expect(seen).not.toContain('2026-7'); // July is open
    expect(seen).toEqual(['2026-6', '2026-5', '2026-4']);
  });

  test('a read failure is recorded, not thrown', () => {
    const database = {
      getAllPayoutsForMonth: () => { throw new Error('db locked'); },
      getVenueEarningsForMonth: () => ({ grossCents: 0 }),
    };

    const result = checkLedgerIntegrity({ database, monthsBack: 1, now: NOW });

    expect(result.problems[0].kind).toBe('read_failed');
  });
});
