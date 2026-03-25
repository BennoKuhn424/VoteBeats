const express = require('express');
const db = require('../utils/database');
const broadcast = require('../utils/broadcast');
const ownerAuthMiddleware = require('../middleware/ownerAuthMiddleware');

const router = express.Router();

router.get('/overview', ownerAuthMiddleware, (req, res) => {
  try {
    const overview = db.getOwnerOverview();
    const connectedClients = broadcast.getConnectedCount();
    res.json({ ...overview, connectedClients });
  } catch (err) {
    console.error('Owner overview error:', err);
    res.status(500).json({ error: 'Failed to load overview' });
  }
});

module.exports = router;
