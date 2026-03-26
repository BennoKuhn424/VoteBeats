/**
 * Integration tests for payment-related HTTP paths.
 */
const request = require('supertest');
const { app } = require('../app');

describe('POST /api/webhooks/yoco', () => {
  test('returns 400 for invalid JSON body', async () => {
    const res = await request(app)
      .post('/api/webhooks/yoco')
      .set('Content-Type', 'application/json')
      .send('not-json{');
    expect(res.status).toBe(400);
  });

  test('returns 200 for non-payment event types (ack)', async () => {
    const res = await request(app)
      .post('/api/webhooks/yoco')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ type: 'other.event' }));
    expect(res.status).toBe(200);
  });

  test('returns 200 when payment.succeeded but no checkoutId (nothing to do)', async () => {
    const res = await request(app)
      .post('/api/webhooks/yoco')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ type: 'payment.succeeded', payload: {} }));
    expect(res.status).toBe(200);
  });
});

describe('POST /api/queue/:venueCode/create-payment validation', () => {
  test('returns 400 when song/deviceId missing', async () => {
    const res = await request(app)
      .post('/api/queue/TEST01/create-payment')
      .set('Content-Type', 'application/json')
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/required/i);
  });
});
