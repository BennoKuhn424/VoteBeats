/**
 * @jest-environment node
 *
 * Grace-period expiry enforcement in checkVenueSubscription.
 *
 * The status flag alone must never grant service: if renewal webhooks stop
 * arriving (broken endpoint, provider outage, dead card with no notification),
 * an 'active' subscription would otherwise stay active forever — service
 * delivered, nothing paid. Past currentPeriodEnd + SUBSCRIPTION_GRACE_DAYS the
 * subscription is treated as expired.
 */

jest.mock('../utils/database');

const db = require('../utils/database');
const { checkVenueSubscription } = require('../middleware/requireSubscriptionActive');

const DAY = 24 * 60 * 60 * 1000;
const savedGrace = process.env.SUBSCRIPTION_GRACE_DAYS;
const savedEnforcement = process.env.SUBSCRIPTION_ENFORCEMENT;

afterEach(() => {
  if (savedGrace === undefined) delete process.env.SUBSCRIPTION_GRACE_DAYS;
  else process.env.SUBSCRIPTION_GRACE_DAYS = savedGrace;
  if (savedEnforcement === undefined) delete process.env.SUBSCRIPTION_ENFORCEMENT;
  else process.env.SUBSCRIPTION_ENFORCEMENT = savedEnforcement;
});

function subWith(overrides) {
  db.getSubscription.mockReturnValue({
    venueCode: 'VEN001',
    status: 'active',
    currentPeriodEnd: Date.now() + 10 * DAY,
    ...overrides,
  });
}

describe('paid-through enforcement', () => {
  test('active within the paid period → ok', () => {
    subWith({ currentPeriodEnd: Date.now() + 10 * DAY });
    expect(checkVenueSubscription('VEN001')).toMatchObject({ ok: true, status: 'active' });
  });

  test('active but period lapsed within grace → still ok (late webhook must not block a paying venue)', () => {
    subWith({ currentPeriodEnd: Date.now() - 2 * DAY }); // default grace = 5 days
    expect(checkVenueSubscription('VEN001')).toMatchObject({ ok: true, status: 'active' });
  });

  test('active but period lapsed beyond grace → expired, service stops', () => {
    subWith({ currentPeriodEnd: Date.now() - 6 * DAY });
    expect(checkVenueSubscription('VEN001')).toMatchObject({ ok: false, status: 'expired' });
  });

  test('trialing subscriptions expire the same way', () => {
    subWith({ status: 'trialing', currentPeriodEnd: Date.now() - 6 * DAY });
    expect(checkVenueSubscription('VEN001')).toMatchObject({ ok: false, status: 'expired' });
  });

  test('SUBSCRIPTION_GRACE_DAYS tunes the window', () => {
    process.env.SUBSCRIPTION_GRACE_DAYS = '10';
    subWith({ currentPeriodEnd: Date.now() - 6 * DAY });
    expect(checkVenueSubscription('VEN001').ok).toBe(true);

    process.env.SUBSCRIPTION_GRACE_DAYS = '0';
    subWith({ currentPeriodEnd: Date.now() - 1000 });
    expect(checkVenueSubscription('VEN001').ok).toBe(false);
  });

  // A row with NO paid-through date at all still gets service — see the
  // comment in the middleware. This guard runs on every request from every
  // venue, so blocking on a missing date would convert one malformed write
  // into a platform-wide outage. It is logged loudly instead. (A record with
  // only a trialEndsAt is a different case and IS enforced — see below.)
  test('no paid-through date of any kind → served, but logged loudly', () => {
    subWith({ currentPeriodEnd: null });
    const err = jest.spyOn(console, 'error').mockImplementation(() => {});

    expect(checkVenueSubscription('VEN001')).toMatchObject({ ok: true, status: 'active' });
    expect(err.mock.calls.map((c) => c[0]).join('\n')).toContain('subscription-no-paid-through-date');

    err.mockRestore();
  });

  test('non-active statuses are untouched by the grace logic', () => {
    subWith({ status: 'past_due', currentPeriodEnd: Date.now() - 30 * DAY });
    expect(checkVenueSubscription('VEN001')).toMatchObject({ ok: false, status: 'past_due' });
  });
});

/**
 * THE BUG, found in production 2026-07-30: a venue's trial ended 23 May and it
 * was still playing music on 30 July.
 *
 * The paid-through check was written as
 *   `if (ACTIVE_STATUSES.has(status) && sub.currentPeriodEnd)`
 * so a subscription that reached 'trialing' but never received a renewal event
 * — no currentPeriodEnd — skipped the expiry branch entirely. `trialEndsAt`
 * was never consulted by this function at all, so the trial end was pure
 * decoration: the venue got unlimited free service, permanently, and nothing
 * surfaced it.
 */
describe('paid-through date falls back to the trial end', () => {
  test('REGRESSION: a trialing sub whose trial ended long ago is expired', () => {
    subWith({ status: 'trialing', currentPeriodEnd: null, trialEndsAt: Date.now() - 60 * DAY });

    expect(checkVenueSubscription('VEN001')).toMatchObject({ ok: false, status: 'expired' });
  });

  test('a trial still running is fine', () => {
    subWith({ status: 'trialing', currentPeriodEnd: null, trialEndsAt: Date.now() + 5 * DAY });

    expect(checkVenueSubscription('VEN001')).toMatchObject({ ok: true, status: 'trialing' });
  });

  test('the grace window still applies to a just-ended trial', () => {
    process.env.SUBSCRIPTION_GRACE_DAYS = '5';
    // Ended 2 days ago — inside grace, so a late activation ITN can still land.
    subWith({ status: 'trialing', currentPeriodEnd: null, trialEndsAt: Date.now() - 2 * DAY });

    expect(checkVenueSubscription('VEN001')).toMatchObject({ ok: true });
  });

  test('past the trial end plus grace → expired', () => {
    process.env.SUBSCRIPTION_GRACE_DAYS = '5';
    subWith({ status: 'trialing', currentPeriodEnd: null, trialEndsAt: Date.now() - 6 * DAY });

    expect(checkVenueSubscription('VEN001')).toMatchObject({ ok: false, status: 'expired' });
  });

  test('currentPeriodEnd wins when both are present', () => {
    // Trial long gone, but a renewal was paid — the venue is current.
    subWith({ status: 'active', currentPeriodEnd: Date.now() + 20 * DAY, trialEndsAt: Date.now() - 60 * DAY });

    expect(checkVenueSubscription('VEN001')).toMatchObject({ ok: true, status: 'active' });
  });

  test('non-active statuses are unaffected by the fallback', () => {
    subWith({ status: 'canceled', currentPeriodEnd: null, trialEndsAt: null });
    expect(checkVenueSubscription('VEN001')).toMatchObject({ ok: false, status: 'canceled' });
  });
});
