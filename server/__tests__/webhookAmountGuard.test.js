/**
 * Regression tests for the webhook amount-guard.
 *
 * THE BUG (pre-fix): if the provider's verifyCheckout returned
 *   { verified: true, amountCents: null }
 * the guard `providerAmount != null && expectedCents != null && providerAmount !== expectedCents`
 * short-circuited and the handler proceeded to fulfilPaidRequest with
 * `providerAmount ?? expectedCents` — fulfilling the song without ever
 * confirming the patron paid the correct amount.
 *
 * THE FIX: both expectedCents AND providerAmount must be finite numbers AND
 * be equal, otherwise we refuse to fulfil. The same guard is applied to the
 * polling-based GET /request-status path.
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

// jest.mock factories run BEFORE module-level consts, so the mocks must
// declare their own jest.fn() instances inside the factory body.
jest.mock('../utils/paymentFulfill', () => ({
  fulfillPaidRequest: jest.fn().mockResolvedValue(true),
}));
jest.mock('../providers/payment', () => {
  const verifyWebhook = jest.fn().mockReturnValue(true);
  const normalizeWebhookEvent = jest.fn();
  const verifyCheckout = jest.fn();
  return {
    getProvider: () => ({
      name: 'yoco',
      isConfigured: () => true,
      verifyWebhook,
      normalizeWebhookEvent,
      verifyCheckout,
    }),
  };
});

// After jest.mock has been hoisted, require the mocked modules to get handles
// on the inner jest.fn instances.
const { fulfillPaidRequest } = require('../utils/paymentFulfill');
const { getProvider } = require('../providers/payment');
const { verifyWebhook, normalizeWebhookEvent, verifyCheckout } = getProvider();

const ORIGINAL_ENV = { ...process.env };
process.env.PUBLIC_URL = 'https://app.speeldit.com';
process.env.CORS_ORIGINS = 'https://app.speeldit.com';

const request = require('supertest');
const db = require('../utils/database');
const { app } = require('../app');

const VENUE_CODE = 'TSTV01';
const CHECKOUT_ID = 'chk_test_amount_guard';
const PAID_AMOUNT = 1000; // R10

beforeEach(() => {
  jest.clearAllMocks();
  fulfillPaidRequest.mockResolvedValue(true);
  verifyWebhook.mockReturnValue(true);
  normalizeWebhookEvent.mockReturnValue({
    kind: 'payment_succeeded',
    checkoutId: CHECKOUT_ID,
    amountCents: PAID_AMOUNT,
  });
  db.getPendingPayment.mockReturnValue({
    venueCode: VENUE_CODE,
    amountCents: PAID_AMOUNT,
    song: { id: 'song_x', appleId: '1' },
    deviceId: 'd1',
  });
  db.getVenue.mockReturnValue({
    code: VENUE_CODE,
    name: 'V',
    settings: { requirePaymentForRequest: true, requestPriceCents: PAID_AMOUNT },
  });
});

afterAll(() => {
  process.env = ORIGINAL_ENV;
});

function postWebhook(body = { type: 'payment.succeeded' }) {
  return request(app)
    .post('/api/webhooks/payment')
    .set('Content-Type', 'application/json')
    .send(JSON.stringify(body));
}

function getStatus() {
  return request(app).get(`/api/queue/${VENUE_CODE}/request-status?checkoutId=${CHECKOUT_ID}`);
}

describe('webhook — amount guard', () => {
  test('REGRESSION: refuses to fulfil when providerAmount is null even though verified', async () => {
    verifyCheckout.mockResolvedValue({ verified: true, amountCents: null });
    const err = jest.spyOn(console, 'error').mockImplementation(() => {});

    const res = await postWebhook();

    expect(res.status).toBe(200); // Ack to prevent retries
    expect(fulfillPaidRequest).not.toHaveBeenCalled();
    const logged = err.mock.calls.map((c) => c[0]).join('\n');
    expect(logged).toContain('webhook-amount-guard-rejected');
    expect(logged).toContain('provider_missing');
    err.mockRestore();
  });

  test('refuses to fulfil when providerAmount is undefined', async () => {
    verifyCheckout.mockResolvedValue({ verified: true });
    const err = jest.spyOn(console, 'error').mockImplementation(() => {});

    const res = await postWebhook();

    expect(res.status).toBe(200);
    expect(fulfillPaidRequest).not.toHaveBeenCalled();
    expect(err.mock.calls.map((c) => c[0]).join('\n')).toContain('provider_missing');
    err.mockRestore();
  });

  test('refuses to fulfil when providerAmount is a non-number ("1000")', async () => {
    verifyCheckout.mockResolvedValue({ verified: true, amountCents: '1000' });
    const err = jest.spyOn(console, 'error').mockImplementation(() => {});

    const res = await postWebhook();

    expect(res.status).toBe(200);
    expect(fulfillPaidRequest).not.toHaveBeenCalled();
    expect(err.mock.calls.map((c) => c[0]).join('\n')).toContain('provider_missing');
    err.mockRestore();
  });

  test('refuses to fulfil when providerAmount is NaN / Infinity', async () => {
    verifyCheckout.mockResolvedValue({ verified: true, amountCents: NaN });
    const r1 = await postWebhook();
    expect(r1.status).toBe(200);
    expect(fulfillPaidRequest).not.toHaveBeenCalled();

    verifyCheckout.mockResolvedValue({ verified: true, amountCents: Infinity });
    const r2 = await postWebhook();
    expect(r2.status).toBe(200);
    expect(fulfillPaidRequest).not.toHaveBeenCalled();
  });

  test('refuses to fulfil when expectedCents is missing on the pending record', async () => {
    db.getPendingPayment.mockReturnValue({
      venueCode: VENUE_CODE,
      // no amountCents — corrupt or legacy pending record
      song: { id: 'song_x', appleId: '1' },
      deviceId: 'd1',
    });
    verifyCheckout.mockResolvedValue({ verified: true, amountCents: PAID_AMOUNT });
    const err = jest.spyOn(console, 'error').mockImplementation(() => {});

    const res = await postWebhook();

    expect(res.status).toBe(200);
    expect(fulfillPaidRequest).not.toHaveBeenCalled();
    expect(err.mock.calls.map((c) => c[0]).join('\n')).toContain('expected_missing');
    err.mockRestore();
  });

  test('refuses to fulfil when amounts mismatch', async () => {
    verifyCheckout.mockResolvedValue({ verified: true, amountCents: 500 }); // half of expected
    const err = jest.spyOn(console, 'error').mockImplementation(() => {});

    const res = await postWebhook();

    expect(res.status).toBe(200);
    expect(fulfillPaidRequest).not.toHaveBeenCalled();
    expect(err.mock.calls.map((c) => c[0]).join('\n')).toContain('mismatch');
    err.mockRestore();
  });

  test('HAPPY PATH: fulfils when amounts match and both are finite numbers', async () => {
    verifyCheckout.mockResolvedValue({ verified: true, amountCents: PAID_AMOUNT });

    const res = await postWebhook();

    expect(res.status).toBe(200);
    expect(fulfillPaidRequest).toHaveBeenCalledWith(CHECKOUT_ID, PAID_AMOUNT);
  });

  test('does nothing when verifyCheckout returns verified:false', async () => {
    verifyCheckout.mockResolvedValue({ verified: false });
    const res = await postWebhook();
    expect(res.status).toBe(200);
    expect(fulfillPaidRequest).not.toHaveBeenCalled();
  });
});

describe('GET /request-status — amount guard', () => {
  test('REGRESSION: refuses to fulfil when providerAmount is null', async () => {
    verifyCheckout.mockResolvedValue({ verified: true, amountCents: null });
    const err = jest.spyOn(console, 'error').mockImplementation(() => {});

    const res = await getStatus();

    expect(res.status).toBe(200);
    expect(res.body.fulfilled).toBe(false);
    expect(fulfillPaidRequest).not.toHaveBeenCalled();
    expect(err.mock.calls.map((c) => c[0]).join('\n')).toContain('request-status-amount-guard-rejected');
    err.mockRestore();
  });

  test('refuses to fulfil when amounts mismatch', async () => {
    verifyCheckout.mockResolvedValue({ verified: true, amountCents: 999 });
    const res = await getStatus();
    expect(res.body.fulfilled).toBe(false);
    expect(fulfillPaidRequest).not.toHaveBeenCalled();
  });

  test('HAPPY PATH: fulfils when amounts match', async () => {
    verifyCheckout.mockResolvedValue({ verified: true, amountCents: PAID_AMOUNT });
    fulfillPaidRequest.mockResolvedValue(true);
    const res = await getStatus();
    expect(res.body.fulfilled).toBe(true);
    expect(fulfillPaidRequest).toHaveBeenCalledWith(CHECKOUT_ID, PAID_AMOUNT);
  });
});
