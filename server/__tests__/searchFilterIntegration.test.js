/**
 * @jest-environment node
 *
 * END-TO-END proof that the /api/search route actually drops explicit songs
 * when a venue is family-friendly — using a realistic Apple Music API response
 * (SICKO MODE, contentRating "explicit") so this catches wiring bugs the unit
 * tests can't. If this passes but the live site lets an explicit song through,
 * the problem is deployment/config (old backend, or the toggle is off), NOT code.
 */

jest.mock('../utils/database');
jest.mock('../utils/appleMusicToken', () => ({
  getDeveloperToken: jest.fn(() => 'test-token'),
  getToken: jest.fn(() => 'test-token'),
}));

const request = require('supertest');
const db = require('../utils/database');
const { app } = require('../app');

// Realistic Apple Music /search payload: one explicit, one clean.
const APPLE_RESPONSE = {
  results: {
    songs: {
      data: [
        {
          id: '1836444433',
          attributes: {
            name: 'SICKO MODE',
            artistName: 'Travis Scott',
            durationInMillis: 312000,
            contentRating: 'explicit',
            genreNames: ['Hip-Hop/Rap'],
            artwork: { url: 'https://example.com/{w}x{h}.jpg' },
          },
        },
        {
          id: 'riptide-id',
          attributes: {
            name: 'Riptide',
            artistName: 'Vance Joy',
            durationInMillis: 204000,
            contentRating: 'clean',
            genreNames: ['Alternative'],
            artwork: { url: 'https://example.com/{w}x{h}.jpg' },
          },
        },
      ],
    },
  },
};

beforeEach(() => {
  jest.clearAllMocks();
  global.fetch = jest.fn(async () => ({ ok: true, json: async () => APPLE_RESPONSE }));
});

describe('GET /api/search — family-friendly drops explicit songs', () => {
  test('family-friendly venue: SICKO MODE (explicit) is removed, Riptide stays', async () => {
    db.getVenue.mockReturnValue({ code: 'FF01', settings: { familyFriendly: true } });

    const res = await request(app).get('/api/search').query({ q: 'sicko', venueCode: 'FF01' });

    expect(res.status).toBe(200);
    const titles = res.body.results.map((r) => r.trackName);
    expect(titles).not.toContain('SICKO MODE'); // the whole point
    expect(titles).toContain('Riptide');
  });

  test('non-family-friendly venue: SICKO MODE is returned, flagged explicit', async () => {
    db.getVenue.mockReturnValue({ code: 'OPEN1', settings: { familyFriendly: false } });

    const res = await request(app).get('/api/search').query({ q: 'sicko', venueCode: 'OPEN1' });

    expect(res.status).toBe(200);
    const sicko = res.body.results.find((r) => r.trackName === 'SICKO MODE');
    expect(sicko).toBeDefined();
    expect(sicko.explicit).toBe(true);
    expect(sicko.rating).toBe('explicit');
  });

  test('search results carry the rating field so request-time can enforce it', async () => {
    db.getVenue.mockReturnValue({ code: 'OPEN1', settings: {} });
    const res = await request(app).get('/api/search').query({ q: 'x', venueCode: 'OPEN1' });
    const riptide = res.body.results.find((r) => r.trackName === 'Riptide');
    expect(riptide.rating).toBe('clean');
  });
});
