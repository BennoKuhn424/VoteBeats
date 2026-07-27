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

  test('no currentPeriodEnd on record → no expiry check (legacy subs unaffected)', () => {
    subWith({ currentPeriodEnd: null });
    expect(checkVenueSubscription('VEN001')).toMatchObject({ ok: true, status: 'active' });
  });

  test('non-active statuses are untouched by the grace logic', () => {
    subWith({ status: 'past_due', currentPeriodEnd: Date.now() - 30 * DAY });
    expect(checkVenueSubscription('VEN001')).toMatchObject({ ok: false, status: 'past_due' });
  });
});
