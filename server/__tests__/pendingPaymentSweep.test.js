/**
 * @jest-environment node
 *
 * The sweep replaces a bare `DELETE ... WHERE created_at < cutoff`, which lost
 * money whenever a patron paid but the webhook never arrived. These tests pin
 * the rule that matters: a stale row is only deleted once the provider has
 * confirmed it was NOT paid.
 */

const { sweepStalePendingPayments } = require('../utils/pendingPaymentSweep');

function makeDb(stale = []) {
  return {
    getStalePendingPayments: jest.fn().mockReturnValue(stale),
    removePendingPayment: jest.fn(),
    recordOrphanedPayment: jest.fn(),
  };
}

function makeProvider({ configured = true, verify } = {}) {
  return {
    name: 'test',
    isConfigured: jest.fn().mockReturnValue(configured),
    verifyCheckout: verify || jest.fn().mockResolvedValue({ verified: false }),
  };
}

const pending = (over = {}) => ({
  checkoutId: 'chk_1',
  venueCode: 'VEN001',
  amountCents: 3000,
  createdAt: Date.now() - 7200_000,
  ...over,
});

describe('sweepStalePendingPayments', () => {
  test('deletes only after the provider confirms the checkout was unpaid', async () => {
    const database = makeDb([pending()]);
    const provider = makeProvider({
      verify: jest.fn().mockResolvedValue({ verified: false }),
    });

    const stats = await sweepStalePendingPayments({ database, provider, fulfill: jest.fn() });

    expect(provider.verifyCheckout).toHaveBeenCalledWith('chk_1');
    expect(database.removePendingPayment).toHaveBeenCalledWith('chk_1');
    expect(stats.deleted).toBe(1);
    expect(stats.fulfilled).toBe(0);
  });

  test('fulfils a paid checkout whose webhook never arrived', async () => {
    const database = makeDb([pending()]);
    const provider = makeProvider({
      verify: jest.fn().mockResolvedValue({ verified: true, amountCents: 3000 }),
    });
    const fulfill = jest.fn().mockResolvedValue(true);

    const stats = await sweepStalePendingPayments({ database, provider, fulfill });

    expect(fulfill).toHaveBeenCalledWith('chk_1', 3000);
    expect(stats.fulfilled).toBe(1);
    expect(stats.deleted).toBe(0);
    // fulfilPaidRequest removes the pending row itself — sweep must not double-delete.
    expect(database.removePendingPayment).not.toHaveBeenCalled();
  });

  test('never deletes when the provider cannot be reached', async () => {
    const database = makeDb([pending()]);
    const provider = makeProvider({
      verify: jest.fn().mockRejectedValue(new Error('network down')),
    });

    const stats = await sweepStalePendingPayments({ database, provider, fulfill: jest.fn() });

    expect(database.removePendingPayment).not.toHaveBeenCalled();
    expect(stats.kept).toBe(1);
    expect(stats.deleted).toBe(0);
  });

  test('never deletes when the provider is unconfigured', async () => {
    const database = makeDb([pending(), pending({ checkoutId: 'chk_2' })]);
    const provider = makeProvider({ configured: false });

    const stats = await sweepStalePendingPayments({ database, provider, fulfill: jest.fn() });

    expect(database.removePendingPayment).not.toHaveBeenCalled();
    expect(provider.verifyCheckout).not.toHaveBeenCalled();
    expect(stats.kept).toBe(2);
  });

  test('parks a paid checkout whose amount does not match', async () => {
    const database = makeDb([pending({ amountCents: 3000 })]);
    const provider = makeProvider({
      verify: jest.fn().mockResolvedValue({ verified: true, amountCents: 500 }),
    });
    const fulfill = jest.fn();

    const stats = await sweepStalePendingPayments({ database, provider, fulfill });

    expect(fulfill).not.toHaveBeenCalled();
    expect(database.recordOrphanedPayment).toHaveBeenCalledWith(
      expect.objectContaining({
        checkoutId: 'chk_1',
        reason: 'amount_mismatch',
        detail: { expectedCents: 3000, providerCents: 500 },
      })
    );
    expect(stats.orphaned).toBe(1);
  });

  test('parks the payment when fulfilment throws', async () => {
    const database = makeDb([pending()]);
    const provider = makeProvider({
      verify: jest.fn().mockResolvedValue({ verified: true, amountCents: 3000 }),
    });
    const fulfill = jest.fn().mockRejectedValue(new Error('queue write failed'));

    const stats = await sweepStalePendingPayments({ database, provider, fulfill });

    expect(database.recordOrphanedPayment).toHaveBeenCalledWith(
      expect.objectContaining({ checkoutId: 'chk_1', reason: 'fulfil_failed' })
    );
    expect(stats.orphaned).toBe(1);
  });

  test('no stale rows is a no-op', async () => {
    const database = makeDb([]);
    const provider = makeProvider();

    const stats = await sweepStalePendingPayments({ database, provider, fulfill: jest.fn() });

    expect(stats.checked).toBe(0);
    expect(provider.verifyCheckout).not.toHaveBeenCalled();
  });

  test('processes a mixed batch independently', async () => {
    const database = makeDb([
      pending({ checkoutId: 'unpaid' }),
      pending({ checkoutId: 'paid' }),
      pending({ checkoutId: 'mismatch' }),
    ]);
    const provider = makeProvider({
      verify: jest.fn(async (id) => {
        if (id === 'paid') return { verified: true, amountCents: 3000 };
        if (id === 'mismatch') return { verified: true, amountCents: 99 };
        return { verified: false };
      }),
    });

    const stats = await sweepStalePendingPayments({
      database,
      provider,
      fulfill: jest.fn().mockResolvedValue(true),
    });

    expect(stats).toMatchObject({ checked: 3, deleted: 1, fulfilled: 1, orphaned: 1 });
  });
});
