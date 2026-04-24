/**
 * Integration tests for payment-related HTTP paths.
 */
const crypto = require('crypto');
const request = require('supertest');
const { app } = require('../app');

describe('POST /api/webhooks/yoco', () => {
  const webhookSecret = Buffer.from('test-webhook-secret').toString('base64');

  beforeEach(() => {
    process.env.YOCO_WEBHOOK_SECRET = `whsec_${webhookSecret}`;
  });

  function signedWebhook(body) {
    const raw = JSON.stringify(body);
    const webhookId = 'msg_test_123';
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = crypto
      .createHmac('sha256', Buffer.from(webhookSecret, 'base64'))
      .update(`${webhookId}.${timestamp}.${raw}`)
      .digest('base64');

    return request(app)
      .post('/api/webhooks/yoco')
      .set('Content-Type', 'application/json')
      .set('webhook-id', webhookId)
      .set('webhook-timestamp', timestamp)
      .set('webhook-signature', `v1,${signature}`)
      .send(raw);
  }

  test('returns 400 for invalid JSON body', async () => {
    const res = await request(app)
      .post('/api/webhooks/yoco')
      .set('Content-Type', 'application/json')
      .send('not-json{');
    expect(res.status).toBe(400);
  });

  test('returns 200 for non-payment event types (ack)', async () => {
    const res = await signedWebhook({ type: 'other.event' });
    expect(res.status).toBe(200);
  });

  test('returns 200 when payment.succeeded but no checkoutId (nothing to do)', async () => {
    const res = await signedWebhook({ type: 'payment.succeeded', payload: {} });
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
    expect(res.body.error).toBeDefined();
  });
});
