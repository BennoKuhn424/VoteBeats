/**
 * Integration tests for POST /api/queue/:venueCode/create-payment focused on
 * the redirect-base resolution.
 *
 * REGRESSION GUARD: previously the route built successUrl/cancelUrl/failureUrl
 * from req.headers.origin (allowlist included it), which let an attacker forge
 * an Origin header (or any non-browser HTTP client) and redirect the patron to
 * a phishing page after payment. The fix delegates to utils/redirectOrigin
 * which trusts only PUBLIC_URL + CORS_ORIGINS (+ localhost in dev).
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
jest.mock('../utils/appleMusicToken', () => ({ getToken: jest.fn().mockResolvedValue('mock-token') }));

// Mock the patron-payment provider so we can capture the createCheckout args
// (this is where successUrl/cancelUrl get sent).
const mockCreateCheckout = jest.fn().mockResolvedValue({
  checkoutId: 'chk_test_abc',
  redirectUrl: 'https://pay.yoco/checkout/abc',
});
jest.mock('../providers/payment', () => ({
  getProvider: () => ({
    name: 'yoco',
    isConfigured: () => true,
    createCheckout: mockCreateCheckout,
    verifyCheckout: jest.fn().mockResolvedValue({ verified: false }),
    normalizeWebhookEvent: jest.fn(),
  }),
}));

const ORIGINAL_ENV = { ...process.env };

// Set env BEFORE app.js loads so its CORS allowlist is built correctly.
process.env.PUBLIC_URL = 'https://app.speeldit.com';
process.env.CORS_ORIGINS = 'https://app.speeldit.com,https://www.speeldit.com';

const request = require('supertest');
const db = require('../utils/database');
const { app } = require('../app');

const VENUE_CODE = 'TSTV01';
const PAID_VENUE = {
  code: VENUE_CODE,
  name: 'Paid Venue',
  settings: {
    requirePaymentForRequest: true,
    requestPriceCents: 1000,
  },
};

beforeEach(() => {
  jest.clearAllMocks();
  db.getVenue.mockReturnValue(PAID_VENUE);
  db.getSubscription.mockReturnValue({ status: 'active' });
  db.setPendingPayment.mockImplementation(() => {});
});

afterAll(() => {
  process.env = ORIGINAL_ENV;
});

function songFixture(overrides = {}) {
  return {
    appleId: '999',
    title: 'Song A',
    artist: 'Artist A',
    albumArt: 'https://example.com/art.jpg',
    duration: 180,
    ...overrides,
  };
}

describe('POST /api/queue/:venueCode/create-payment — redirect base safety', () => {
  test('SECURITY: a victim browser sending a malicious clientOrigin is redirected only to PUBLIC_URL', async () => {
    // Realistic browser-side scenario: the request comes from the legitimate
    // SPA origin (allowed by CORS) but an attacker has tampered with the
    // request body to inject a malicious clientOrigin. The route MUST ignore it.
    const res = await request(app)
      .post(`/api/queue/${VENUE_CODE}/create-payment`)
      .set('Origin', 'https://app.speeldit.com')
      .send({
        song: songFixture(),
        deviceId: 'device_1234567890abcdef',
        clientOrigin: 'https://attacker.example.com',
      });

    expect(res.status).toBe(200);
    expect(mockCreateCheckout).toHaveBeenCalledTimes(1);

    const { successUrl, cancelUrl, failureUrl } = mockCreateCheckout.mock.calls[0][0];
    expect(successUrl).toBe(`https://app.speeldit.com/v/${VENUE_CODE}/request-success`);
    expect(cancelUrl).toBe(`https://app.speeldit.com/v/${VENUE_CODE}`);
    expect(failureUrl).toBe(`https://app.speeldit.com/v/${VENUE_CODE}`);
    expect(successUrl).not.toContain('attacker');
    expect(cancelUrl).not.toContain('attacker');
  });

  test('SECURITY: a non-browser client setting BOTH Origin and clientOrigin to the attacker is still safe', async () => {
    // Threat model: attacker uses curl/Postman/server-side HTTP and sets a
    // matching Origin + clientOrigin. The CORS allowlist normally rejects this
    // at the CORS layer (proven below by the 500 — the request never reaches
    // the route). Even so, the route's allowlist is the second line of defence.
    const res = await request(app)
      .post(`/api/queue/${VENUE_CODE}/create-payment`)
      .set('Origin', 'https://attacker.example.com')
      .send({
        song: songFixture(),
        deviceId: 'device_1234567890abcdef',
        clientOrigin: 'https://attacker.example.com',
      });

    // Either CORS blocks at the edge (status not 200) OR the route ran and
    // safely picked PUBLIC_URL — either way no attacker URL was sent to
    // the payment provider.
    if (res.status === 200) {
      const { successUrl } = mockCreateCheckout.mock.calls[0][0];
      expect(successUrl).toBe(`https://app.speeldit.com/v/${VENUE_CODE}/request-success`);
      expect(successUrl).not.toContain('attacker');
    } else {
      expect(mockCreateCheckout).not.toHaveBeenCalled();
    }
  });

  test('SECURITY: ignores attacker-only clientOrigin even with no Origin header', async () => {
    const res = await request(app)
      .post(`/api/queue/${VENUE_CODE}/create-payment`)
      .send({
        song: songFixture(),
        deviceId: 'device_1234567890abcdef',
        clientOrigin: 'https://attacker.example.com',
      });

    expect(res.status).toBe(200);
    const { successUrl } = mockCreateCheckout.mock.calls[0][0];
    expect(successUrl.startsWith('https://app.speeldit.com/')).toBe(true);
  });

  test('SECURITY: ignores scheme-downgraded clientOrigin (http instead of https)', async () => {
    const res = await request(app)
      .post(`/api/queue/${VENUE_CODE}/create-payment`)
      .send({
        song: songFixture(),
        deviceId: 'device_1234567890abcdef',
        clientOrigin: 'http://app.speeldit.com',
      });

    expect(res.status).toBe(200);
    const { successUrl } = mockCreateCheckout.mock.calls[0][0];
    expect(successUrl).toBe(`https://app.speeldit.com/v/${VENUE_CODE}/request-success`);
  });

  test('uses clientOrigin when it matches an allowlisted CORS_ORIGINS entry', async () => {
    const res = await request(app)
      .post(`/api/queue/${VENUE_CODE}/create-payment`)
      .send({
        song: songFixture(),
        deviceId: 'device_1234567890abcdef',
        clientOrigin: 'https://www.speeldit.com',
      });

    expect(res.status).toBe(200);
    const { successUrl, cancelUrl } = mockCreateCheckout.mock.calls[0][0];
    expect(successUrl).toBe(`https://www.speeldit.com/v/${VENUE_CODE}/request-success`);
    expect(cancelUrl).toBe(`https://www.speeldit.com/v/${VENUE_CODE}`);
  });

  test('falls back to PUBLIC_URL when clientOrigin is missing entirely', async () => {
    const res = await request(app)
      .post(`/api/queue/${VENUE_CODE}/create-payment`)
      .send({
        song: songFixture(),
        deviceId: 'device_1234567890abcdef',
      });

    expect(res.status).toBe(200);
    const { successUrl } = mockCreateCheckout.mock.calls[0][0];
    expect(successUrl).toBe(`https://app.speeldit.com/v/${VENUE_CODE}/request-success`);
  });

  test('logs a warning event when clientOrigin is rejected', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    await request(app)
      .post(`/api/queue/${VENUE_CODE}/create-payment`)
      .send({
        song: songFixture(),
        deviceId: 'device_1234567890abcdef',
        clientOrigin: 'https://attacker.example.com',
      });

    const logged = warn.mock.calls.map((c) => c[0]).join('\n');
    expect(logged).toContain('redirect-origin-rejected');
    expect(logged).toContain('attacker.example.com');
    warn.mockRestore();
  });
});
