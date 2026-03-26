const db = require('../utils/database');
const queueRepo = require('../repos/queueRepo');
const broadcast = require('../utils/broadcast');
const { fulfillPaidRequest } = require('../utils/paymentFulfill');
const { verifyCheckoutWithYoco } = require('../utils/yoco');

/**
 * POST /api/queue/:venueCode/create-payment
 * GET /api/queue/:venueCode/request-status
 */
function attachPaymentRoutes(router) {
  router.post('/:venueCode/create-payment', async (req, res) => {
    const { venueCode } = req.params;
    const { song, deviceId, clientOrigin } = req.body;

    if (!song?.appleId || !song?.title || !deviceId || typeof deviceId !== 'string') {
      return res.status(400).json({ error: 'song (appleId, title) and deviceId are required' });
    }

    const venue = db.getVenue(venueCode);
    if (!venue) return res.status(404).json({ error: 'Venue not found' });
    if (!venue.settings?.requirePaymentForRequest) {
      return res.status(400).json({ error: 'This venue does not require payment for requests' });
    }

    const priceCents = venue.settings.requestPriceCents ?? 1000;
    if (priceCents < 500 || priceCents > 5000) {
      return res.status(400).json({ error: 'Invalid request price' });
    }

    const yocoSecret = process.env.YOCO_SECRET_KEY;
    if (!yocoSecret) {
      return res.status(503).json({ error: 'Payment integration not configured' });
    }

    const allowedOrigins = [req.headers.origin, process.env.PUBLIC_URL].filter(Boolean);
    let baseUrl = process.env.PUBLIC_URL || req.headers.origin || 'http://localhost:5173';
    if (typeof clientOrigin === 'string' && clientOrigin) {
      try {
        const parsed = new URL(clientOrigin);
        if (allowedOrigins.some((o) => { try { return new URL(o).origin === parsed.origin; } catch { return false; } })) {
          baseUrl = clientOrigin;
        }
      } catch { /* invalid URL */ }
    }
    const base = baseUrl.replace(/\/$/, '');
    const successUrl = `${base}/v/${venueCode}/request-success`;
    const cancelUrl = `${base}/v/${venueCode}`;
    const failureUrl = cancelUrl;

    try {
      const response = await fetch('https://payments.yoco.com/api/checkouts', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${yocoSecret}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          amount: priceCents,
          currency: 'ZAR',
          successUrl,
          cancelUrl,
          failureUrl,
          metadata: { venueCode },
        }),
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        return res.status(response.status).json({ error: errData.message || 'Payment creation failed' });
      }
      const data = await response.json();

      const checkoutId = data.id;
      const redirectUrl = data.redirectUrl;
      if (!checkoutId || !redirectUrl) {
        return res.status(500).json({ error: 'Invalid response from payment provider' });
      }

      db.setPendingPayment(checkoutId, {
        venueCode,
        amountCents: priceCents,
        song: {
          id: song.id || `song_${song.appleId}`,
          appleId: song.appleId,
          title: song.title,
          artist: song.artist,
          albumArt: song.albumArt,
          duration: song.duration,
        },
        deviceId,
      });

      res.json({ redirectUrl, checkoutId });
    } catch (err) {
      console.error('Yoco checkout error:', err);
      res.status(500).json({ error: 'Could not create payment' });
    }
  });

  router.get('/:venueCode/request-status', async (req, res) => {
    const { venueCode } = req.params;
    const { checkoutId } = req.query;
    if (!checkoutId || typeof checkoutId !== 'string') return res.status(400).json({ error: 'checkoutId required' });

    const pending = db.getPendingPayment(checkoutId);
    if (!pending) return res.json({ fulfilled: true });
    if (pending.venueCode !== venueCode) {
      return res.status(403).json({ error: 'Invalid checkout' });
    }

    const yocoSecret = process.env.YOCO_SECRET_KEY;
    if (yocoSecret) {
      try {
        const { verified, amountCents } = await verifyCheckoutWithYoco(checkoutId, yocoSecret);
        if (verified) {
          const amt = amountCents ?? pending.amountCents;
          if (await fulfillPaidRequest(checkoutId, amt)) {
            broadcast.broadcastQueue(venueCode, queueRepo.get(venueCode));
            return res.json({ fulfilled: true });
          }
        }
      } catch (err) {
        console.warn('Yoco checkout status fetch failed:', err.message);
      }
    }

    res.json({ fulfilled: false });
  });
}

module.exports = attachPaymentRoutes;
