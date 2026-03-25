const request = require('supertest');
const { app } = require('../app');

describe('Owner API', () => {
  test('GET /api/owner/overview without token returns 401', async () => {
    await request(app).get('/api/owner/overview').expect(401);
  });
});
