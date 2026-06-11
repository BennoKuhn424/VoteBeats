const db = require('../utils/database');
const queueRepo = require('../repos/queueRepo');
const broadcast = require('../utils/broadcast');
const { fulfillPaidRequest } = require('../utils/paymentFulfill');
const { getProvider } = require('../providers/payment');
const { requireVenueSubscriptionActive } = require('../middleware/requireSubscriptionActive');
const { checkRequestAllowed } = require('../utils/requestRules');
const E = require('../utils/errorCodes');
const validate = require('../middleware/validate');
const { createPaymentSchema } = require('../utils/schemas');
const { resolveRedirectBase } = require('../utils/redirectOrigin');

/**
 * POST /api/queue/:venueCode/create-payment
 * GET /api/queue/:venueCode/request-status
 *
 * Provider-agnostic — depends only on the PatronPaymentProvider interface.
 * Swap checkout vendors via PATRON_PAYMENT_PROVIDER env var.
 */
function attachPaymentRoutes(router) {
  router.post('/:venueCode/create-payment', requireVenueSubscriptionActive, validate(createPaymentSchema), async (req, res) => {
    const { venueCode } = req.params;
    const { song, deviceId, clientOrigin } = req.body;

    const venue = db.getVenue(venueCode);
    if (!venue) return res.status(404).json({ error: 'Venue not found', code: E.PAYMENT_VENUE_NOT_FOUND });
    if (!venue.settings?.requirePaymentForRequest) {
      return res.status(400).json({ error: 'This venue does not require payment for requests', code: E.PAYMENT_NOT_REQUIRED });
    }

    // Family-friendly / genre rules apply before we start a paid checkout, so a
    // patron is never charged for a song the venue would reject. Awaited:
    // family-friendly may do a lyric check on the song.
    const blocked = await checkRequestAllowed(venue, song);
    if (blocked) return res.status(blocked.status).json(blocked.body);

    const priceCents = venue.settings.requestPriceCents ?? 1000;
    if (priceCents < 500 || priceCents > 5000) {
      return res.status(400).json({ error: 'Invalid request price', code: E.PAYMENT_INVALID_PRICE });
    }

    const provider = getProvider();
    if (!provider.isConfigured()) {
      return res.status(503).json({ error: 'Payment integration not configured', code: E.PAYMENT_NOT_CONFIGURED });
    }

    // SECURITY: redirect base is resolved from server-controlled allowlist only.
    // Never trust req.headers.origin — see server/utils/redirectOrigin.js.
    const { baseUrl: base, source } = resolveRedirectBase(clientOrigin);
    if (typeof clientOrigin === 'string' && clientOrigin && source !== 'client') {
      console.warn(JSON.stringify({
        t: new Date().toISOString(),
        msg: 'redirect-origin-rejected',
        venueCode,
        clientOrigin,
        usedSource: source,
      }));
    }
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
        // SECURITY: same hard amount guard as the webhook — never fulfil
        // unless the provider returned a numeric amount that matches what
        // the patron was charged. Keeps the polling path consistent with
        // the webhook path.
        const expected = pending.amountCents;
        if (
          verified
          && Number.isFinite(amountCents)
          && Number.isFinite(expected)
          && amountCents === expected
        ) {
          if (await fulfillPaidRequest(checkoutId, amountCents)) {
            broadcast.broadcastQueue(venueCode, queueRepo.get(venueCode));
            return res.json({ fulfilled: true });
          }
        } else if (verified) {
          console.error(JSON.stringify({
            t: new Date().toISOString(),
            msg: 'request-status-amount-guard-rejected',
            provider: provider.name,
            checkoutId,
            venueCode,
            expectedCents: Number.isFinite(expected) ? expected : null,
            providerAmount: Number.isFinite(amountCents) ? amountCents : null,
          }));
        }
      } catch (err) {
        console.warn(`[${provider.name}] checkout status fetch failed:`, err.message);
      }
    }

    res.json({ fulfilled: false });
  });
}

module.exports = attachPaymentRoutes;
