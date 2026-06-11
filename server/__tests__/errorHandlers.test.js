/**
 * Verifies the centralized 404 + error handling added in middleware/errorHandlers.js:
 * every fall-through response is JSON with a stable { error, code } shape, never
 * HTML and never a stack trace.
 */
const request = require('supertest');
const { app } = require('../app');

describe('centralized error handling', () => {
  it('returns a JSON 404 for an unmatched route', async () => {
    const res = await request(app).get('/api/this-route-does-not-exist');
    expect(res.status).toBe(404);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.body).toEqual({ error: 'Not found', code: 'NOT_FOUND' });
  });

  it('returns JSON 400 for a malformed JSON body', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .set('Content-Type', 'application/json')
      .send('{"email": "a@b.com", '); // truncated / invalid JSON
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_JSON');
  });

  it('returns JSON 413 when the body exceeds the size limit', async () => {
    const huge = JSON.stringify({ blob: 'x'.repeat(60 * 1024) }); // > 50kb limit
    const res = await request(app)
      .post('/api/auth/login')
      .set('Content-Type', 'application/json')
      .send(huge);
    expect(res.status).toBe(413);
    expect(res.body.code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('returns JSON 403 for a disallowed CORS origin', async () => {
    const res = await request(app)
      .get('/api/health')
      .set('Origin', 'https://evil.example.com');
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: 'Origin not allowed', code: 'CORS_FORBIDDEN' });
  });

  it('still serves a normal request (sanity: handlers do not shadow routes)', async () => {
    const res = await request(app).get('/api/health');
    expect([200, 503]).toContain(res.status); // 200 healthy, 503 if DB probe fails
    expect(res.body.service).toBe('speeldit-api');
  });
});
