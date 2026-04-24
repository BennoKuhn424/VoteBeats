/**
 * @jest-environment node
 *
 * Tests for PUT /api/venue/:venueCode/theme.
 *
 * Key property under test: this route is NOT subscription-gated. A venue with
 * a canceled/past-due/none subscription must still be able to save their
 * theme choice so they can use the dashboard while they pay.
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
jest.mock('../utils/yoco', () => ({
  verifyCheckoutWithYoco: jest.fn().mockResolvedValue({ verified: false }),
  verifyYocoWebhookSignature: jest.fn().mockReturnValue(true),
}));
jest.mock('../utils/appleMusicToken', () => ({ getToken: jest.fn().mockResolvedValue('mock-token') }));

const request = require('supertest');
const jwt = require('jsonwebtoken');
const db = require('../utils/database');
const { app } = require('../app');

const JWT_SECRET = process.env.JWT_SECRET || 'speeldit-dev-secret-change-in-production';

function venueJwt(venueCode, csrf = 'csrf-tok') {
  return jwt.sign({ venueCode, csrf, jti: `jti-${venueCode}` }, JWT_SECRET, { expiresIn: '7d' });
}

function authedPut(venueCode, body) {
  return request(app)
    .put(`/api/venue/${venueCode}/theme`)
    .set('Cookie', `auth_token=${venueJwt(venueCode)}`)
    .set('X-CSRF-Token', 'csrf-tok')
    .send(body);
}

beforeEach(() => {
  jest.resetAllMocks();
});

describe('PUT /api/venue/:venueCode/theme', () => {
  test('returns 401 without an auth cookie', async () => {
    const res = await request(app)
      .put('/api/venue/TSTV01/theme')
      .send({ theme: 'dark' });
    expect(res.status).toBe(401);
  });

  test('returns 400 for missing / invalid theme', async () => {
    db.getVenue.mockReturnValue({ code: 'TSTV01', settings: {} });
    const cases = [{}, { theme: 'sepia' }, { theme: '' }, { theme: null }, { theme: 123 }];
    for (const body of cases) {
      const res = await authedPut('TSTV01', body);
      expect(res.status).toBe(400);
    }
  });

  test('saves theme=dark and returns { theme } on success', async () => {
    const venue = { code: 'TSTV01', settings: {} };
    db.getVenue.mockReturnValue(venue);
    db.saveVenue.mockImplementation(() => {});

    const res = await authedPut('TSTV01', { theme: 'dark' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ theme: 'dark' });
    expect(db.saveVenue).toHaveBeenCalledWith(
      'TSTV01',
      expect.objectContaining({
        settings: expect.objectContaining({ theme: 'dark' }),
      }),
    );
  });

  test('saves theme=light on success', async () => {
    db.getVenue.mockReturnValue({ code: 'TSTV01', settings: {} });
    db.saveVenue.mockImplementation(() => {});
    const res = await authedPut('TSTV01', { theme: 'light' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ theme: 'light' });
  });

  test('rejects cross-venue write (authed as A, writing to B)', async () => {
    db.getVenue.mockImplementation((code) => ({ code, settings: {} }));
    db.saveVenue.mockImplementation(() => {});

    const res = await request(app)
      .put('/api/venue/OTHER1/theme')
      .set('Cookie', `auth_token=${venueJwt('TSTV01')}`)
      .set('X-CSRF-Token', 'csrf-tok')
      .send({ theme: 'dark' });

    expect(res.status).toBe(403);
    expect(db.saveVenue).not.toHaveBeenCalled();
  });

  test('works when subscription status is canceled (theme is NOT gated)', async () => {
    // Even with a canceled subscription, the owner must be able to
    // save their theme choice.
    db.getVenue.mockReturnValue({ code: 'TSTV01', settings: {} });
    db.getSubscription.mockReturnValue({ status: 'canceled' });
    db.saveVenue.mockImplementation(() => {});

    const res = await authedPut('TSTV01', { theme: 'dark' });
    expect(res.status).toBe(200);
  });

  test('works when SUBSCRIPTION_ENFORCEMENT=strict and no subscription exists', async () => {
    const prev = process.env.SUBSCRIPTION_ENFORCEMENT;
    process.env.SUBSCRIPTION_ENFORCEMENT = 'strict';
    try {
      db.getVenue.mockReturnValue({ code: 'TSTV01', settings: {} });
      db.getSubscription.mockReturnValue(null);
      db.saveVenue.mockImplementation(() => {});

      const res = await authedPut('TSTV01', { theme: 'light' });
      expect(res.status).toBe(200);
    } finally {
      if (prev === undefined) delete process.env.SUBSCRIPTION_ENFORCEMENT;
      else process.env.SUBSCRIPTION_ENFORCEMENT = prev;
    }
  });

  test('preserves other settings on the venue', async () => {
    const venue = {
      code: 'TSTV01',
      settings: {
        allowExplicit: true,
        maxSongsPerUser: 3,
        genreFilters: ['amapiano'],
      },
    };
    db.getVenue.mockReturnValue(venue);
    db.saveVenue.mockImplementation(() => {});

    const res = await authedPut('TSTV01', { theme: 'dark' });
    expect(res.status).toBe(200);
    expect(db.saveVenue).toHaveBeenCalledWith(
      'TSTV01',
      expect.objectContaining({
        settings: expect.objectContaining({
          theme: 'dark',
          allowExplicit: true,
          maxSongsPerUser: 3,
          genreFilters: ['amapiano'],
        }),
      }),
    );
  });
});
