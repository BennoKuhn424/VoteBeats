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
const { encryptBankDetails, decryptBankDetails } = require('../utils/bankDetailsCrypto');
const { checkLedgerIntegrity } = require('../utils/ledgerIntegrity');

const router = express.Router();

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

    db.recordAuditEvent({
      actorRole: 'owner',
      actorId: req.owner?.jti,
      action: 'payout.generate',
      targetType: 'payout-batch',
      targetId: `${year}-${String(month).padStart(2, '0')}`,
      ip: req.ip,
      detail: { created, totalForMonth: payouts.length },
    });

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
    const { status, notes, proofReference } = req.body;

    if (!['pending', 'paid', 'failed'].includes(status)) {
      return res.status(400).json({ error: 'Status must be pending, paid, or failed' });
    }

    const payout = db.getPayoutById(id);
    if (!payout) {
      return res.status(404).json({ error: 'Payout not found' });
    }

    // Marking money as paid requires evidence of the transfer, so a venue
    // disputing it can be shown a bank reference rather than a bare flag.
    const proofRef = String(proofReference || '').trim();
    if (status === 'paid' && !proofRef) {
      return res.status(400).json({
        error: 'proofReference is required when marking a payout as paid',
        code: 'PROOF_REQUIRED',
      });
    }

    db.updatePayoutStatus(id, status, notes || '', proofRef ? { reference: proofRef, recordedBy: req.owner?.jti } : undefined);
    const updated = db.getPayoutById(id);

    db.recordAuditEvent({
      actorRole: 'owner',
      actorId: req.owner?.jti,
      action: 'payout.status-change',
      targetType: 'payout',
      targetId: id,
      venueCode: payout.venueCode,
      ip: req.ip,
      detail: {
        from: payout.status,
        to: status,
        amountCents: payout.venueAmountCents,
        monthLabel: payout.monthLabel,
        proofReference: proofRef || null,
        notes: notes || '',
      },
    });

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
    const { proofReference } = req.body;
    year = parseInt(year, 10);
    month = parseInt(month, 10);
    if (!year || !month || month < 1 || month > 12) {
      return res.status(400).json({ error: 'Invalid year or month' });
    }

    // Same evidence rule as the single-payout path — a bulk click still moves
    // real money and still has to be defensible per venue afterwards.
    const proofRef = String(proofReference || '').trim();
    if (!proofRef) {
      return res.status(400).json({
        error: 'proofReference is required when marking payouts as paid',
        code: 'PROOF_REQUIRED',
      });
    }

    const payouts = db.getAllPayoutsForMonth(year, month);
    const markedIds = [];
    let totalCents = 0;
    for (const p of payouts) {
      if (p.status === 'pending') {
        db.updatePayoutStatus(p.id, 'paid', 'Bulk marked as paid', {
          reference: proofRef,
          recordedBy: req.owner?.jti,
        });
        markedIds.push(p.id);
        totalCents += p.venueAmountCents || 0;
      }
    }

    db.recordAuditEvent({
      actorRole: 'owner',
      actorId: req.owner?.jti,
      action: 'payout.mark-all-paid',
      targetType: 'payout-batch',
      targetId: `${year}-${String(month).padStart(2, '0')}`,
      ip: req.ip,
      detail: {
        count: markedIds.length,
        totalCents,
        proofReference: proofRef,
        payoutIds: markedIds,
      },
    });

    res.json({ message: `Marked ${markedIds.length} payout(s) as paid`, marked: markedIds.length });
  } catch (err) {
    console.error('Bulk mark paid error:', err);
    res.status(500).json({ error: 'Failed to mark payouts as paid' });
  }
});

/**
 * GET /api/payouts/outstanding
 * Every venue that is owed money, across all unpaid months, biggest first.
 * This is the owner dashboard's "who do I owe" view — a venue can carry more
 * than one unpaid month, so this aggregates rather than showing a single month.
 */
router.get('/outstanding', ownerAuthMiddleware, (req, res) => {
  try {
    const venues = db.getAllVenuesOutstanding();
    const enriched = venues.map((v) => {
      const venue = db.getVenue(v.venueCode);
      return {
        ...v,
        venueName: venue?.name || v.venueCode,
        bankDetails: decryptBankDetails(venue?.settings?.bankDetails),
      };
    });
    const totalCents = enriched.reduce((s, v) => s + v.outstandingCents, 0);

    res.json({
      venues: enriched,
      totalCents,
      totalRand: (totalCents / 100).toFixed(2),
      venueCount: enriched.length,
    });
  } catch (err) {
    console.error('Outstanding balances error:', err);
    res.status(500).json({ error: 'Failed to load outstanding balances' });
  }
});

/**
 * GET /api/payouts/reconcile?year=2026&month=6
 * Independent cross-check of the two money records: recompute the split from
 * the raw `payments` rows and compare against the stored `payouts` rollup.
 * They are derived separately, so any mismatch means a payout row was written
 * from different data than the transactions it claims to cover — or edited
 * after the fact. Run this before paying anyone.
 */
router.get('/reconcile', ownerAuthMiddleware, (req, res) => {
  try {
    let { year, month } = req.query;
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

    const payouts = db.getAllPayoutsForMonth(year, month);
    const rows = payouts.map((p) => {
      // Source of truth #2: the individual payment transactions.
      const earnings = db.getVenueEarningsForMonth(p.venueCode, year, month) || {};
      const actualGrossCents = earnings.grossCents || 0;
      const expectedVenueCents = Math.round(actualGrossCents * ((p.venueSharePercent || 70) / 100));
      const expectedPlatformCents = actualGrossCents - expectedVenueCents;

      const grossDeltaCents = (p.grossCents || 0) - actualGrossCents;
      const venueDeltaCents = (p.venueAmountCents || 0) - expectedVenueCents;
      const platformDeltaCents = (p.platformAmountCents || 0) - expectedPlatformCents;

      return {
        payoutId: p.id,
        venueCode: p.venueCode,
        monthLabel: p.monthLabel,
        status: p.status,
        paymentCount: earnings.count || 0,
        recorded: {
          grossCents: p.grossCents || 0,
          venueAmountCents: p.venueAmountCents || 0,
          platformAmountCents: p.platformAmountCents || 0,
        },
        recomputed: {
          grossCents: actualGrossCents,
          venueAmountCents: expectedVenueCents,
          platformAmountCents: expectedPlatformCents,
        },
        grossDeltaCents,
        venueDeltaCents,
        platformDeltaCents,
        balanced: grossDeltaCents === 0 && venueDeltaCents === 0 && platformDeltaCents === 0,
      };
    });

    const mismatches = rows.filter((r) => !r.balanced);
    res.json({
      monthLabel: `${year}-${String(month).padStart(2, '0')}`,
      checked: rows.length,
      balanced: mismatches.length === 0,
      mismatchCount: mismatches.length,
      rows,
    });
  } catch (err) {
    console.error('Payout reconcile error:', err);
    res.status(500).json({ error: 'Failed to reconcile payouts' });
  }
});

/**
 * GET /api/payouts/orphaned
 * Money the provider took that could not be booked as a payment (webhook never
 * landed and the checkout expired, amount mismatch, fulfilment crash). These
 * need manual settlement — they are deliberately surfaced rather than dropped.
 */
router.get('/orphaned', ownerAuthMiddleware, (req, res) => {
  try {
    const includeResolved = req.query.includeResolved === 'true';
    const orphans = db.getOrphanedPayments({ includeResolved });
    const unresolvedCents = orphans
      .filter((o) => !o.resolved)
      .reduce((s, o) => s + (o.amountCents || 0), 0);

    res.json({
      orphans,
      unresolvedCount: orphans.filter((o) => !o.resolved).length,
      unresolvedCents,
      unresolvedRand: (unresolvedCents / 100).toFixed(2),
    });
  } catch (err) {
    console.error('Orphaned payments error:', err);
    res.status(500).json({ error: 'Failed to load orphaned payments' });
  }
});

/**
 * PUT /api/payouts/orphaned/:checkoutId/resolve
 * Mark an orphaned payment as handled, with a note describing what was done.
 */
router.put('/orphaned/:checkoutId/resolve', ownerAuthMiddleware, (req, res) => {
  try {
    const { checkoutId } = req.params;
    const note = String(req.body?.note || '').trim();
    if (!note) {
      return res.status(400).json({ error: 'A note describing the resolution is required' });
    }

    const ok = db.resolveOrphanedPayment(checkoutId, note);
    if (!ok) return res.status(404).json({ error: 'Orphaned payment not found' });

    db.recordAuditEvent({
      actorRole: 'owner',
      actorId: req.owner?.jti,
      action: 'payout.orphan-resolved',
      targetType: 'orphaned-payment',
      targetId: checkoutId,
      ip: req.ip,
      detail: { note },
    });

    res.json({ message: 'Orphaned payment marked resolved' });
  } catch (err) {
    console.error('Resolve orphaned payment error:', err);
    res.status(500).json({ error: 'Failed to resolve orphaned payment' });
  }
});

/**
 * GET /api/payouts/integrity
 * On-demand ledger self-check: confirms payouts never drifted from the raw
 * payment rows. A clean result is the evidence that the money records are sound.
 */
router.get('/integrity', ownerAuthMiddleware, (req, res) => {
  try {
    const monthsBack = Math.min(parseInt(req.query.monthsBack, 10) || 6, 24);
    const result = checkLedgerIntegrity({ monthsBack });
    res.json({
      ok: result.problems.length === 0,
      checkedMonths: result.checkedMonths,
      checkedPayouts: result.checkedPayouts,
      problemCount: result.problems.length,
      problems: result.problems,
    });
  } catch (err) {
    console.error('Ledger integrity error:', err);
    res.status(500).json({ error: 'Failed to run integrity check' });
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
 * GET /api/payouts/venue/:venueCode/outstanding
 * What this venue is still owed, across every unpaid month, plus what they
 * earned in the current month (which has usually not been paid out yet).
 */
router.get('/venue/:venueCode/outstanding', authMiddleware, (req, res) => {
  try {
    if (req.venue.code !== req.params.venueCode) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    const outstanding = db.getVenueOutstanding(req.params.venueCode);

    // Current month's takings are not yet in a payout record — surface them
    // separately so "earned this month" and "owed to you" don't get conflated.
    const now = new Date();
    const earnings = db.getVenueEarningsForMonth(
      req.params.venueCode,
      now.getFullYear(),
      now.getMonth() + 1
    );
    const vspRaw = parseInt(process.env.VENUE_EARNINGS_PERCENT, 10);
    const vsp = Number.isFinite(vspRaw) && vspRaw >= 0 && vspRaw <= 100 ? vspRaw : 70;
    const thisMonthVenueCents = Math.round((earnings?.grossCents || 0) * (vsp / 100));

    res.json({
      ...outstanding,
      thisMonth: {
        grossCents: earnings?.grossCents || 0,
        venueAmountCents: thisMonthVenueCents,
        venueAmountRand: (thisMonthVenueCents / 100).toFixed(2),
        requestCount: earnings?.count || 0,
        monthLabel: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`,
      },
      venueSharePercent: vsp,
    });
  } catch (err) {
    console.error('Venue outstanding error:', err);
    res.status(500).json({ error: 'Failed to load outstanding balance' });
  }
});

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

    const previousMasked = (() => {
      const prev = decryptBankDetails(venue.settings?.bankDetails);
      if (!prev) return null;
      return {
        bankName: prev.bankName || null,
        accountLast4: prev.accountNumber ? prev.accountNumber.slice(-4) : null,
      };
    })();

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

    // Log only non-sensitive metadata — never the full account number.
    db.recordAuditEvent({
      actorRole: 'venue',
      actorId: req.venue?.code,
      action: 'venue.bank-details-update',
      targetType: 'venue',
      targetId: req.venue?.code,
      venueCode: req.venue?.code,
      ip: req.ip,
      detail: {
        bankName: bankName.trim(),
        accountLast4: cleanAccNum.slice(-4),
        accountType: accountType || 'cheque',
        previous: previousMasked,
      },
    });

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
