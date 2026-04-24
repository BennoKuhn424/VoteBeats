/**
 * Payout management routes — platform owner only.
 *
 * Handles monthly payout generation, status tracking, and venue bank details.
 * All routes require owner authentication (ownerAuthMiddleware).
 */

const express = require('express');
const db = require('../utils/database');
const ownerAuthMiddleware = require('../middleware/ownerAuthMiddleware');
const authMiddleware = require('../middleware/authMiddleware');
const E = require('../utils/errorCodes');
const paymentCrypto = require('../utils/paymentCrypto');

const router = express.Router();

const BANK_DETAIL_SECRET_FIELDS = ['accountHolder', 'accountNumber', 'branchCode'];

function encryptBankDetails(details) {
  const out = { ...details };
  if (!paymentCrypto.ENABLED) return out;
  for (const field of BANK_DETAIL_SECRET_FIELDS) {
    if (out[field]) out[field] = paymentCrypto.encrypt(String(out[field])) || String(out[field]);
  }
  out._encrypted = true;
  return out;
}

function decryptBankDetails(details) {
  if (!details) return null;
  const out = { ...details };
  for (const field of BANK_DETAIL_SECRET_FIELDS) {
    if (!out[field]) continue;
    const decrypted = paymentCrypto.decrypt(String(out[field]));
    out[field] = decrypted !== null ? decrypted : out[field];
  }
  delete out._encrypted;
  return out;
}

// ── Owner routes (platform admin) ───────────────────────────────────────────

/**
 * POST /api/payouts/generate
 * Generate payout records for a specific month.
 * Body: { year, month } — defaults to previous month if not provided.
 */
router.post('/generate', ownerAuthMiddleware, (req, res) => {
  try {
    let { year, month } = req.body;

    // Default to previous month
    if (!year || !month) {
      const now = new Date();
      const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      year = prev.getFullYear();
      month = prev.getMonth() + 1;
    }

    year = parseInt(year, 10);
    month = parseInt(month, 10);
    if (!year || !month || month < 1 || month > 12) {
      return res.status(400).json({ error: 'Invalid year or month' });
    }

    const created = db.generateMonthlyPayouts(year, month);
    const payouts = db.getAllPayoutsForMonth(year, month);

    res.json({
      message: `Generated ${created} new payout(s) for ${year}-${String(month).padStart(2, '0')}`,
      created,
      payouts,
    });
  } catch (err) {
    console.error('Payout generation error:', err);
    res.status(500).json({ error: 'Failed to generate payouts' });
  }
});

/**
 * GET /api/payouts?status=pending&year=2026&month=4
 * List payouts with optional filters.
 */
router.get('/', ownerAuthMiddleware, (req, res) => {
  try {
    const { status, year, month } = req.query;

    let payouts;
    if (year && month) {
      payouts = db.getAllPayoutsForMonth(parseInt(year, 10), parseInt(month, 10));
      if (status) payouts = payouts.filter((p) => p.status === status);
    } else if (status) {
      payouts = db.getPayoutsByStatus(status);
    } else {
      // Default: show all pending
      payouts = db.getPayoutsByStatus('pending');
    }

    // Attach venue name and bank details to each payout
    const enriched = payouts.map((p) => {
      const venue = db.getVenue(p.venueCode);
      return {
        ...p,
        venueName: venue?.name || p.venueCode,
        bankDetails: decryptBankDetails(venue?.settings?.bankDetails),
      };
    });

    res.json({ payouts: enriched });
  } catch (err) {
    console.error('Payout list error:', err);
    res.status(500).json({ error: 'Failed to load payouts' });
  }
});

/**
 * PUT /api/payouts/:id/status
 * Update a payout's status (pending → paid, or mark as failed).
 * Body: { status: 'paid'|'failed'|'pending', notes?: string }
 */
router.put('/:id/status', ownerAuthMiddleware, (req, res) => {
  try {
    const { id } = req.params;
    const { status, notes } = req.body;

    if (!['pending', 'paid', 'failed'].includes(status)) {
      return res.status(400).json({ error: 'Status must be pending, paid, or failed' });
    }

    const payout = db.getPayoutById(id);
    if (!payout) {
      return res.status(404).json({ error: 'Payout not found' });
    }

    db.updatePayoutStatus(id, status, notes || '');
    const updated = db.getPayoutById(id);
    res.json({ payout: updated });
  } catch (err) {
    console.error('Payout status update error:', err);
    res.status(500).json({ error: 'Failed to update payout status' });
  }
});

/**
 * POST /api/payouts/mark-all-paid
 * Bulk-mark all pending payouts for a month as paid.
 * Body: { year, month }
 */
router.post('/mark-all-paid', ownerAuthMiddleware, (req, res) => {
  try {
    let { year, month } = req.body;
    year = parseInt(year, 10);
    month = parseInt(month, 10);
    if (!year || !month || month < 1 || month > 12) {
      return res.status(400).json({ error: 'Invalid year or month' });
    }

    const payouts = db.getAllPayoutsForMonth(year, month);
    let marked = 0;
    for (const p of payouts) {
      if (p.status === 'pending') {
        db.updatePayoutStatus(p.id, 'paid', 'Bulk marked as paid');
        marked++;
      }
    }

    res.json({ message: `Marked ${marked} payout(s) as paid`, marked });
  } catch (err) {
    console.error('Bulk mark paid error:', err);
    res.status(500).json({ error: 'Failed to mark payouts as paid' });
  }
});

/**
 * GET /api/payouts/summary
 * Summary of all payouts grouped by status.
 */
router.get('/summary', ownerAuthMiddleware, (req, res) => {
  try {
    const pending = db.getPayoutsByStatus('pending');
    const paid = db.getPayoutsByStatus('paid');

    const pendingTotal = pending.reduce((s, p) => s + p.venueAmountCents, 0);
    const paidTotal = paid.reduce((s, p) => s + p.venueAmountCents, 0);

    res.json({
      pending: { count: pending.length, totalCents: pendingTotal, totalRand: (pendingTotal / 100).toFixed(2) },
      paid: { count: paid.length, totalCents: paidTotal, totalRand: (paidTotal / 100).toFixed(2) },
    });
  } catch (err) {
    console.error('Payout summary error:', err);
    res.status(500).json({ error: 'Failed to load payout summary' });
  }
});

// ── Venue routes (venue owner sees their own payouts) ───────────────────────

/**
 * GET /api/payouts/venue/:venueCode
 * A venue owner can see their own payout history.
 */
router.get('/venue/:venueCode', authMiddleware, (req, res) => {
  try {
    if (req.venue.code !== req.params.venueCode) {
      return res.status(403).json({ error: 'Unauthorized' });
    }
    const payouts = db.getPayoutsForVenue(req.params.venueCode);
    res.json({ payouts });
  } catch (err) {
    console.error('Venue payout history error:', err);
    res.status(500).json({ error: 'Failed to load payout history' });
  }
});

// ── Bank details (stored in venue settings) ─────────────────────────────────

/**
 * PUT /api/payouts/venue/:venueCode/bank-details
 * Venue owner updates their bank details for payouts.
 * Body: { bankName, accountHolder, accountNumber, branchCode, accountType }
 */
router.put('/venue/:venueCode/bank-details', authMiddleware, (req, res) => {
  try {
    if (req.venue.code !== req.params.venueCode) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    const { bankName, accountHolder, accountNumber, branchCode, accountType } = req.body;

    if (!bankName || !accountHolder || !accountNumber || !branchCode) {
      return res.status(400).json({ error: 'bankName, accountHolder, accountNumber, and branchCode are required' });
    }

    // Validate account number (digits only, 7-16 chars for SA banks)
    const cleanAccNum = String(accountNumber).replace(/\s/g, '');
    if (!/^\d{7,16}$/.test(cleanAccNum)) {
      return res.status(400).json({ error: 'Account number must be 7-16 digits' });
    }

    // Validate branch code (6 digits for SA universal branch codes)
    const cleanBranch = String(branchCode).replace(/\s/g, '');
    if (!/^\d{5,6}$/.test(cleanBranch)) {
      return res.status(400).json({ error: 'Branch code must be 5-6 digits' });
    }

    const venue = db.getVenue(req.params.venueCode);
    if (!venue) return res.status(404).json({ error: 'Venue not found' });

    if (!venue.settings) venue.settings = {};
    venue.settings.bankDetails = encryptBankDetails({
      bankName: bankName.trim(),
      accountHolder: accountHolder.trim(),
      accountNumber: cleanAccNum,
      branchCode: cleanBranch,
      accountType: accountType || 'cheque',
      updatedAt: Date.now(),
    });

    db.saveVenue(req.params.venueCode, venue);

    res.json({ message: 'Bank details updated', bankDetails: decryptBankDetails(venue.settings.bankDetails) });
  } catch (err) {
    console.error('Bank details update error:', err);
    res.status(500).json({ error: 'Failed to update bank details' });
  }
});

/**
 * GET /api/payouts/venue/:venueCode/bank-details
 * Venue owner reads their bank details.
 */
router.get('/venue/:venueCode/bank-details', authMiddleware, (req, res) => {
  try {
    if (req.venue.code !== req.params.venueCode) {
      return res.status(403).json({ error: 'Unauthorized' });
    }
    const venue = db.getVenue(req.params.venueCode);
    if (!venue) return res.status(404).json({ error: 'Venue not found' });

    res.json({ bankDetails: decryptBankDetails(venue.settings?.bankDetails) });
  } catch (err) {
    console.error('Bank details read error:', err);
    res.status(500).json({ error: 'Failed to load bank details' });
  }
});

module.exports = router;
