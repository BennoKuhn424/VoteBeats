const request = require('supertest');
const { app } = require('../app');

describe('HTTP app', () => {
  test('GET /health', async () => {
    const res = await request(app).get('/health').expect(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.service).toBe('speeldit-api');
  });

  test('GET /api/health', async () => {
    const res = await request(app).get('/api/health').expect(200);
    expect(res.body.ok).toBe(true);
  });
});
