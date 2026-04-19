const express = require('express');
const { getProvider } = require('../providers');

const router = express.Router();

/**
 * GET /api/token — returns the active provider's client-facing credential.
 * Response shape is stable across providers:
 *   { provider: "apple"|"spotify"|..., developerToken: string|null }
 * Clients read `provider` to pick the matching playback SDK.
 * 503 when the configured provider has no token (e.g. missing .p8).
 */
router.get('/', (req, res) => {
  const provider = getProvider();
  const token = provider.getToken();
  if (!token) {
    return res.status(503).json({
      provider: provider.name,
      error: 'Music provider not configured. Check server env for provider credentials.',
    });
  }
  res.json({ provider: provider.name, developerToken: token });
});

module.exports = router;
