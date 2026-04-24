/**
 * @jest-environment node
 *
 * Route tests for PUT /api/venue/:venueCode/settings — specifically the
 * new `strictExplicit` and `blockedTitleWords` fields.
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
    .put(`/api/venue/${venueCode}/settings`)
    .set('Cookie', `auth_token=${venueJwt(venueCode)}`)
    .set('X-CSRF-Token', 'csrf-tok')
    .send(body);
}

beforeEach(() => {
  jest.resetAllMocks();
  db.getSubscription.mockReturnValue({ status: 'active' });
});

describe('PUT /api/venue/:venueCode/settings — strictExplicit', () => {
  test('saves strictExplicit=true', async () => {
    db.getVenue.mockReturnValue({ code: 'TSTV01', settings: {} });
    db.saveVenue.mockImplementation(() => {});

    const res = await authedPut('TSTV01', { strictExplicit: true });
    expect(res.status).toBe(200);
    expect(db.saveVenue).toHaveBeenCalledWith(
      'TSTV01',
      expect.objectContaining({
        settings: expect.objectContaining({ strictExplicit: true }),
      }),
    );
  });

  test('saves strictExplicit=false', async () => {
    db.getVenue.mockReturnValue({ code: 'TSTV01', settings: { strictExplicit: true } });
    db.saveVenue.mockImplementation(() => {});

    const res = await authedPut('TSTV01', { strictExplicit: false });
    expect(res.status).toBe(200);
    expect(db.saveVenue).toHaveBeenCalledWith(
      'TSTV01',
      expect.objectContaining({
        settings: expect.objectContaining({ strictExplicit: false }),
      }),
    );
  });

  test('ignores non-boolean strictExplicit', async () => {
    const existing = { code: 'TSTV01', settings: { strictExplicit: true } };
    db.getVenue.mockReturnValue(existing);
    db.saveVenue.mockImplementation(() => {});

    const res = await authedPut('TSTV01', { strictExplicit: 'yes' });
    expect(res.status).toBe(200);
    // Should have NOT overwritten the existing value
    expect(existing.settings.strictExplicit).toBe(true);
  });
});

describe('PUT /api/venue/:venueCode/settings — blockedTitleWords', () => {
  test('saves a list of words, trims, drops empties, dedupes', async () => {
    db.getVenue.mockReturnValue({ code: 'TSTV01', settings: {} });
    db.saveVenue.mockImplementation(() => {});

    const res = await authedPut('TSTV01', {
      blockedTitleWords: ['hate', '  hate  ', 'HATE', 'evil', '', '   '],
    });
    expect(res.status).toBe(200);

    const saved = db.saveVenue.mock.calls[0][1];
    expect(saved.settings.blockedTitleWords).toEqual(['hate', 'evil']);
  });

  test('rejects >200 words', async () => {
    db.getVenue.mockReturnValue({ code: 'TSTV01', settings: {} });
    const words = Array.from({ length: 201 }, (_, i) => `word${i}`);
    const res = await authedPut('TSTV01', { blockedTitleWords: words });
    expect(res.status).toBe(400);
  });

  test('rejects words longer than 50 chars', async () => {
    db.getVenue.mockReturnValue({ code: 'TSTV01', settings: {} });
    const res = await authedPut('TSTV01', { blockedTitleWords: ['x'.repeat(51)] });
    expect(res.status).toBe(400);
  });

  test('rejects non-string entries', async () => {
    db.getVenue.mockReturnValue({ code: 'TSTV01', settings: {} });
    const res = await authedPut('TSTV01', { blockedTitleWords: ['ok', 123] });
    expect(res.status).toBe(400);
  });

  test('accepts empty list (clears the block)', async () => {
    db.getVenue.mockReturnValue({ code: 'TSTV01', settings: { blockedTitleWords: ['hate'] } });
    db.saveVenue.mockImplementation(() => {});

    const res = await authedPut('TSTV01', { blockedTitleWords: [] });
    expect(res.status).toBe(200);

    const saved = db.saveVenue.mock.calls[0][1];
    expect(saved.settings.blockedTitleWords).toEqual([]);
  });

  test('preserves other settings when updating blockedTitleWords', async () => {
    db.getVenue.mockReturnValue({
      code: 'TSTV01',
      settings: {
        allowExplicit: false,
        maxSongsPerUser: 3,
        blockedArtists: ['Artist A'],
      },
    });
    db.saveVenue.mockImplementation(() => {});

    const res = await authedPut('TSTV01', { blockedTitleWords: ['hate'] });
    expect(res.status).toBe(200);

    const saved = db.saveVenue.mock.calls[0][1];
    expect(saved.settings.allowExplicit).toBe(false);
    expect(saved.settings.maxSongsPerUser).toBe(3);
    expect(saved.settings.blockedArtists).toEqual(['Artist A']);
    expect(saved.settings.blockedTitleWords).toEqual(['hate']);
  });
});
