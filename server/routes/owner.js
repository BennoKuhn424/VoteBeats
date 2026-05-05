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

// Read-only audit-log viewer. Owner-only — `recordAuditEvent` writes from
// payout/banking flows, this endpoint just surfaces them. Filters are all
// optional; results are newest-first and capped server-side at 1000.
router.get('/audit-log', ownerLimiter, ownerAuthMiddleware, (req, res) => {
  try {
    const { actorRole, targetType, targetId, venueCode, sinceMs, limit } = req.query;
    const entries = db.getAuditLog({
      actorRole: actorRole || null,
      targetType: targetType || null,
      targetId: targetId || null,
      venueCode: venueCode || null,
      sinceMs: sinceMs ? Number(sinceMs) : null,
      limit: limit ? Number(limit) : 100,
    });
    // Parse `detail` JSON for the client; fall back to the raw string if
    // the row was written with a non-JSON detail (older entries, manual edits).
    const out = entries.map((e) => ({
      id: e.id,
      actorRole: e.actor_role,
      actorId: e.actor_id,
      action: e.action,
      targetType: e.target_type,
      targetId: e.target_id,
      venueCode: e.venue_code,
      ip: e.ip,
      detail: parseDetail(e.detail),
      createdAt: e.created_at,
    }));
    res.json({ entries: out });
  } catch (err) {
    console.error('Audit log fetch error:', err);
    res.status(500).json({ error: 'Failed to load audit log', code: E.OWNER_OVERVIEW_FAILED });
  }
});

function parseDetail(raw) {
  if (raw == null) return null;
  if (typeof raw !== 'string') return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

module.exports = router;
