/**
 * @jest-environment node
 *
 * Unit tests for the provider-agnostic subscription webhook handler.
 *
 * Mocks the database + email layer so we can assert exactly what the handler
 * writes on each normalized event kind without booting a real DB or Resend.
 */

jest.mock('../utils/database');
jest.mock('../utils/email', () => ({
  sendSubscriptionReceiptEmail: jest.fn().mockResolvedValue(undefined),
  sendSubscriptionPaymentFailedEmail: jest.fn().mockResolvedValue(undefined),
  sendSubscriptionCanceledEmail: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../providers/subscription', () => ({
  getProvider: jest.fn(),
}));

const db = require('../utils/database');
const email = require('../utils/email');
const { getProvider } = require('../providers/subscription');
const { subscriptionWebhook } = require('../routes/subscriptionWebhooks');

function mockRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.sendStatus = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

function mockReq({ body = {}, ip = '1.2.3.4', headers = {} } = {}) {
  const raw = Buffer.from(typeof body === 'string' ? body : JSON.stringify(body), 'utf8');
  return { body: raw, ip, headers, socket: { remoteAddress: ip } };
}

function stubProvider({ verify = true, normalize } = {}) {
  getProvider.mockReturnValue({
    name: 'paystack',
    verifyWebhook: jest.fn().mockReturnValue(verify),
    normalizeWebhookEvent: normalize || jest.fn(() => ({ kind: 'unhandled' })),
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  db.getSubscriptionByProviderId.mockReturnValue(null);
  db.getVenue.mockReturnValue(null);
  db.upsertSubscription.mockImplementation(() => {});
});

describe('subscriptionWebhook — signature + rate limit gates', () => {
  test('returns 403 when provider rejects signature', async () => {
    stubProvider({ verify: false });
    const res = mockRes();
    await subscriptionWebhook(mockReq({ body: { event: 'x' } }), res);
    expect(res.sendStatus).toHaveBeenCalledWith(403);
  });

  test('returns 400 on invalid JSON body', async () => {
    stubProvider({ verify: true });
    const res = mockRes();
    await subscriptionWebhook(mockReq({ body: 'not-json{' }), res);
    expect(res.sendStatus).toHaveBeenCalledWith(400);
  });
});

describe('subscriptionWebhook — normalized event dispatch', () => {
  test('subscription_activated → writes status=trialing when trial still active', async () => {
    const trialEndsAt = Date.now() + 10 * 24 * 60 * 60 * 1000;
    const existing = { venueCode: 'VEN001', providerSubscriptionId: 'SUB_x', trialEndsAt };
    db.getSubscriptionByProviderId.mockReturnValue(existing);

    stubProvider({
      verify: true,
      normalize: () => ({
        kind: 'subscription_activated',
        providerSubscriptionId: 'SUB_x',
        nextPaymentDate: trialEndsAt,
      }),
    });

    const res = mockRes();
    await subscriptionWebhook(mockReq({ body: { event: 'subscription.create' } }), res);

    expect(db.upsertSubscription).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'trialing' })
    );
    expect(res.sendStatus).toHaveBeenCalledWith(200);
  });

  test('subscription_activated → writes status=active when trial expired', async () => {
    const existing = { venueCode: 'VEN001', providerSubscriptionId: 'SUB_x', trialEndsAt: 1 };
    db.getSubscriptionByProviderId.mockReturnValue(existing);

    stubProvider({
      verify: true,
      normalize: () => ({ kind: 'subscription_activated', providerSubscriptionId: 'SUB_x' }),
    });

    const res = mockRes();
    await subscriptionWebhook(mockReq({ body: { event: 'subscription.create' } }), res);

    expect(db.upsertSubscription).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'active' })
    );
  });

  test('charge_succeeded → status=active, updates period end, sends receipt', async () => {
    const sub = { venueCode: 'VEN001', providerSubscriptionId: 'SUB_x' };
    db.getSubscriptionByProviderId.mockReturnValue(sub);
    db.getVenue.mockReturnValue({ name: 'Test Bar', owner: { email: 'a@b.com' } });

    const periodEnd = Date.now() + 30 * 24 * 60 * 60 * 1000;
    stubProvider({
      verify: true,
      normalize: () => ({ kind: 'charge_succeeded', providerSubscriptionId: 'SUB_x', nextPaymentDate: periodEnd }),
    });

    const res = mockRes();
    await subscriptionWebhook(mockReq({ body: { event: 'charge.success' } }), res);

    expect(db.upsertSubscription).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'active', currentPeriodEnd: periodEnd })
    );
    expect(email.sendSubscriptionReceiptEmail).toHaveBeenCalledWith(
      'a@b.com',
      expect.objectContaining({ venueName: 'Test Bar', nextPaymentDate: periodEnd })
    );
  });

  test('payment_failed → status=past_due, sends payment-failed email', async () => {
    const sub = { venueCode: 'VEN001', providerSubscriptionId: 'SUB_x' };
    db.getSubscriptionByProviderId.mockReturnValue(sub);
    db.getVenue.mockReturnValue({ name: 'Test Bar', owner: { email: 'a@b.com' } });

    stubProvider({
      verify: true,
      normalize: () => ({ kind: 'payment_failed', providerSubscriptionId: 'SUB_x' }),
    });

    const res = mockRes();
    await subscriptionWebhook(mockReq({ body: { event: 'invoice.payment_failed' } }), res);

    expect(db.upsertSubscription).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'past_due' })
    );
    expect(email.sendSubscriptionPaymentFailedEmail).toHaveBeenCalled();
  });

  test('subscription_canceled → status=canceled, sends cancel email', async () => {
    const sub = { venueCode: 'VEN001', providerSubscriptionId: 'SUB_x' };
    db.getSubscriptionByProviderId.mockReturnValue(sub);
    db.getVenue.mockReturnValue({ name: 'Test Bar', owner: { email: 'a@b.com' } });

    stubProvider({
      verify: true,
      normalize: () => ({ kind: 'subscription_canceled', providerSubscriptionId: 'SUB_x' }),
    });

    const res = mockRes();
    await subscriptionWebhook(mockReq({ body: { event: 'subscription.disable' } }), res);

    expect(db.upsertSubscription).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'canceled' })
    );
    expect(email.sendSubscriptionCanceledEmail).toHaveBeenCalled();
  });

  test('unknown event kind → acks 200 without DB writes', async () => {
    stubProvider({ verify: true, normalize: () => ({ kind: 'unhandled', rawEvent: 'random' }) });
    const res = mockRes();
    await subscriptionWebhook(mockReq({ body: { event: 'random' } }), res);

    expect(res.sendStatus).toHaveBeenCalledWith(200);
    expect(db.upsertSubscription).not.toHaveBeenCalled();
  });

  test('event for unknown subscription is a silent no-op (still 200)', async () => {
    db.getSubscriptionByProviderId.mockReturnValue(null);
    stubProvider({
      verify: true,
      normalize: () => ({ kind: 'charge_succeeded', providerSubscriptionId: 'SUB_unknown' }),
    });

    const res = mockRes();
    await subscriptionWebhook(mockReq({ body: { event: 'charge.success' } }), res);

    expect(db.upsertSubscription).not.toHaveBeenCalled();
    expect(res.sendStatus).toHaveBeenCalledWith(200);
  });

  test('handler swallows downstream errors (provider never retries)', async () => {
    const sub = { venueCode: 'VEN001', providerSubscriptionId: 'SUB_x' };
    db.getSubscriptionByProviderId.mockReturnValue(sub);
    db.upsertSubscription.mockImplementation(() => { throw new Error('db exploded'); });

    stubProvider({
      verify: true,
      normalize: () => ({ kind: 'charge_succeeded', providerSubscriptionId: 'SUB_x' }),
    });

    const res = mockRes();
    await subscriptionWebhook(mockReq({ body: { event: 'charge.success' } }), res);

    expect(res.sendStatus).toHaveBeenCalledWith(200);
  });
});
