const db = require('../utils/database');
const queueRepo = require('../repos/queueRepo');
const broadcast = require('../utils/broadcast');
const { fulfillPaidRequest } = require('../utils/paymentFulfill');
const { getProvider } = require('../providers/payment');
const E = require('../utils/errorCodes');
const validate = require('../middleware/validate');
const { createPaymentSchema } = require('../utils/schemas');

/**
 * POST /api/queue/:venueCode/create-payment
 * GET /api/queue/:venueCode/request-status
 *
 * Provider-agnostic — depends only on the PatronPaymentProvider interface.
 * Swap checkout vendors via PATRON_PAYMENT_PROVIDER env var.
 */
function attachPaymentRoutes(router) {
  router.post('/:venueCode/create-payment', validate(createPaymentSchema), async (req, res) => {
    const { venueCode } = req.params;
    const { song, deviceId, clientOrigin } = req.body;

    const venue = db.getVenue(venueCode);
    if (!venue) return res.status(404).json({ error: 'Venue not found', code: E.PAYMENT_VENUE_NOT_FOUND });
    if (!venue.settings?.requirePaymentForRequest) {
      return res.status(400).json({ error: 'This venue does not require payment for requests', code: E.PAYMENT_NOT_REQUIRED });
    }

    const priceCents = venue.settings.requestPriceCents ?? 1000;
    if (priceCents < 500 || priceCents > 5000) {
      return res.status(400).json({ error: 'Invalid request price', code: E.PAYMENT_INVALID_PRICE });
    }

    const provider = getProvider();
    if (!provider.isConfigured()) {
      return res.status(503).json({ error: 'Payment integration not configured', code: E.PAYMENT_NOT_CONFIGURED });
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
      const { checkoutId, redirectUrl } = await provider.createCheckout({
        amountCents: priceCents,
        currency: 'ZAR',
        successUrl,
        cancelUrl,
        failureUrl,
        metadata: { venueCode },
      });

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
      console.error(`[${provider.name}] checkout error:`, err.message);
      const status = err.status && err.status >= 400 && err.status < 500 ? err.status : 500;
      res.status(status).json({
        error: err.message || 'Could not create payment',
        code: err.code || E.PAYMENT_CREATE_FAILED,
      });
    }
  });

  router.get('/:venueCode/request-status', async (req, res) => {
    const { venueCode } = req.params;
    const { checkoutId } = req.query;
    if (!checkoutId || typeof checkoutId !== 'string') return res.status(400).json({ error: 'checkoutId required', code: E.PAYMENT_CHECKOUT_REQUIRED });

    const pending = db.getPendingPayment(checkoutId);
    if (!pending) return res.json({ fulfilled: true });
    if (pending.venueCode !== venueCode) {
      return res.status(403).json({ error: 'Invalid checkout', code: E.PAYMENT_CHECKOUT_INVALID });
    }

    const provider = getProvider();
    if (provider.isConfigured()) {
      try {
        const { verified, amountCents } = await provider.verifyCheckout(checkoutId);
        if (verified) {
          const amt = amountCents ?? pending.amountCents;
          if (await fulfillPaidRequest(checkoutId, amt)) {
            broadcast.broadcastQueue(venueCode, queueRepo.get(venueCode));
            return res.json({ fulfilled: true });
          }
        }
      } catch (err) {
        console.warn(`[${provider.name}] checkout status fetch failed:`, err.message);
      }
    }

    res.json({ fulfilled: false });
  });
}

module.exports = attachPaymentRoutes;
