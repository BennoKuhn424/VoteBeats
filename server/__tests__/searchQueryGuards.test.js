/**
 * @jest-environment node
 *
 * Input guards on GET /api/search.
 *
 * The route forwards `q` to the upstream music catalog on every hit. Left
 * unbounded, a single request could push a multi-kilobyte string through to
 * that API — repeated cheaply, and on our API quota, not the caller's. No real
 * track title comes near the cap, so rejecting early costs nothing.
 */

jest.mock('../utils/database');
jest.mock('../utils/appleMusicToken', () => ({
  getDeveloperToken: jest.fn(() => 'test-token'),
  getToken: jest.fn(() => 'test-token'),
}));

const request = require('supertest');
const E = require('../utils/errorCodes');
const { app } = require('../app');

const EMPTY_RESULTS = { results: { songs: { data: [] } } };

beforeEach(() => {
  jest.clearAllMocks();
  global.fetch = jest.fn(async () => ({ ok: true, json: async () => EMPTY_RESULTS }));
});

describe('GET /api/search — query length', () => {
  test('a 200-character query is accepted', async () => {
    const res = await request(app).get('/api/search').query({ q: 'a'.repeat(200) });

    expect(res.status).toBe(200);
    expect(global.fetch).toHaveBeenCalled();
  });

  test('a 201-character query is rejected before the upstream call', async () => {
    const res = await request(app).get('/api/search').query({ q: 'a'.repeat(201) });

    expect(res.status).toBe(400);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('a multi-kilobyte query never reaches the catalog API', async () => {
    const res = await request(app).get('/api/search').query({ q: 'x'.repeat(8000) });

    expect(res.status).toBe(400);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  // "too long" and "missing" are different problems and different fixes, so
  // the client has to be able to tell them apart.
  test('too-long and missing report distinct error codes', async () => {
    const tooLong = await request(app).get('/api/search').query({ q: 'a'.repeat(500) });
    const missing = await request(app).get('/api/search');

    expect(tooLong.body.code).toBe(E.SEARCH_QUERY_TOO_LONG);
    expect(missing.body.code).toBe(E.SEARCH_QUERY_REQUIRED);
    expect(tooLong.body.code).not.toBe(missing.body.code);
  });

  test('an ordinary song title is unaffected', async () => {
    const res = await request(app).get('/api/search').query({ q: 'Everything I Wanted' });

    expect(res.status).toBe(200);
    expect(global.fetch).toHaveBeenCalled();
  });
});
