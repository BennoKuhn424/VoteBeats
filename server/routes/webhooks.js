const express = require('express');
const db = require('../utils/database');
const { fulfillPaidRequest } = require('../utils/paymentFulfill');

// Yoco webhook – must use raw body (see server.js). Express.raw puts Buffer in req.body.
// POST /api/webhooks/yoco
async function yocoWebhook(req, res) {
  let payload;
  try {
    const body = typeof req.body === 'string' ? req.body : (req.body && req.body.toString ? req.body.toString() : '');
    payload = JSON.parse(body || '{}');
  } catch {
    return res.sendStatus(400);
  }

  if (payload.type !== 'payment.succeeded') {
    return res.sendStatus(200);
  }

  // Yoco may send checkoutId in metadata or use payload.id as the checkout identifier
  const checkoutId =
    payload.payload?.metadata?.checkoutId ?? payload.payload?.id ?? payload.id;
  if (!checkoutId) {
    return res.sendStatus(200);
  }

  const amountCents = payload.payload?.amount;
  if (await fulfillPaidRequest(checkoutId, amountCents)) {
    // Song added
  }

  res.sendStatus(200);
}

module.exports = { yocoWebhook };
