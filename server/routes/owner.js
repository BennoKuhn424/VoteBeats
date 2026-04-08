const express = require('express');
const db = require('../utils/database');
const broadcast = require('../utils/broadcast');
const ownerAuthMiddleware = require('../middleware/ownerAuthMiddleware');
const { ownerLimiter } = require('../middleware/rateLimiters');
const E = require('../utils/errorCodes');

const router = express.Router();

router.get('/overview', ownerLimiter, ownerAuthMiddleware, (req, res) => {
  try {
    const overview = db.getOwnerOverview();
    const connectedClients = broadcast.getConnectedCount();
    res.json({ ...overview, connectedClients });
  } catch (err) {
    console.error('Owner overview error:', err);
    res.status(500).json({ error: 'Failed to load overview', code: E.OWNER_OVERVIEW_FAILED });
  }
});

module.exports = router;
