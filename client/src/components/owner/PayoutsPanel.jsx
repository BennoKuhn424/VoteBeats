import { useState, useEffect, useCallback } from 'react';
import { Banknote, RefreshCw, CheckCircle2, AlertTriangle, ChevronRight, Scale } from 'lucide-react';
import api from '../../utils/api';

/**
 * Owner payouts panel — who is owed money, and the control to settle it.
 *
 * Three things happen here:
 *   1. Outstanding balances per venue, aggregated across every unpaid month.
 *   2. Marking a venue paid, which REQUIRES a proof-of-payment reference —
 *      the server rejects the call without one (400 PROOF_REQUIRED), so the
 *      reference input is part of the confirm step rather than optional.
 *   3. Reconciliation: recompute the split from raw payment rows and compare
 *      against the stored payout totals. Run before transferring money.
 *
 * Bank details come back decrypted from the server so the owner can actually
 * make the EFT — they are shown only inside the expanded row.
 */
function formatRand(cents) {
  const n = Number.isFinite(Number(cents)) ? Number(cents) : 0;
  return `R${(n / 100).toFixed(2)}`;
}

export default function PayoutsPanel() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState(null);
  const [payingId, setPayingId] = useState(null);
  const [proofRef, setProofRef] = useState('');
  const [busy, setBusy] = useState(false);
  const [recon, setRecon] = useState(null);
  const [reconBusy, setReconBusy] = useState(false);
  const [orphans, setOrphans] = useState(null);
  const [orphanNotes, setOrphanNotes] = useState({});

  const load = useCallback(async () => {
    try {
      const [outstanding, orphaned] = await Promise.all([
        api.getOutstandingPayouts(),
        // Orphans are supplementary — a failure here must not hide the payouts.
        api.getOrphanedPayments().catch(() => ({ data: { orphans: [], unresolvedCount: 0 } })),
      ]);
      setData(outstanding.data);
      setOrphans(orphaned.data);
      setError('');
    } catch (e) {
      setError(e.response?.data?.error || 'Could not load outstanding payouts');
    } finally {
      setLoading(false);
    }
  }, []);

  async function resolveOrphan(checkoutId) {
    const note = orphanNotes[checkoutId]?.trim();
    if (!note) return;
    try {
      await api.resolveOrphanedPayment(checkoutId, note);
      setOrphanNotes((prev) => ({ ...prev, [checkoutId]: '' }));
      await load();
    } catch (e) {
      setError(e.response?.data?.error || 'Could not resolve orphaned payment');
    }
  }

  useEffect(() => {
    load();
  }, [load]);

  async function runReconcile() {
    setReconBusy(true);
    try {
      const now = new Date();
      const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const res = await api.reconcilePayouts(prev.getFullYear(), prev.getMonth() + 1);
      setRecon(res.data);
    } catch (e) {
      setRecon({ error: e.response?.data?.error || 'Reconcile failed' });
    } finally {
      setReconBusy(false);
    }
  }

  async function markMonthPaid(payoutId) {
    const reference = proofRef.trim();
    if (!reference) return;
    setBusy(true);
    try {
      await api.updatePayoutStatus(payoutId, 'paid', '', reference);
      setPayingId(null);
      setProofRef('');
      await load();
    } catch (e) {
      setError(e.response?.data?.error || 'Could not mark payout as paid');
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50 shadow-elevated p-6">
        <div className="flex items-center gap-2 text-zinc-400">
          <RefreshCw className="w-4 h-4 animate-spin" />
          Loading payouts…
        </div>
      </div>
    );
  }

  const venues = data?.venues || [];

  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50 shadow-elevated motion-safe:animate-fade-up overflow-hidden">
      <div className="px-6 py-4 border-b border-zinc-800 flex flex-wrap items-center gap-3 justify-between">
        <h2 className="font-semibold flex items-center gap-2">
          <Banknote className="w-5 h-5 text-emerald-400" />
          Payouts owed
          {venues.length > 0 && (
            <span className="text-sm font-normal text-zinc-400">
              · {formatRand(data?.totalCents)} across {data?.venueCount} venue
              {data?.venueCount === 1 ? '' : 's'}
            </span>
          )}
        </h2>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={runReconcile}
            disabled={reconBusy}
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-zinc-700 text-sm text-zinc-300 hover:bg-zinc-800 disabled:opacity-50"
          >
            <Scale className="w-4 h-4" />
            {reconBusy ? 'Checking…' : 'Reconcile last month'}
          </button>
          <button
            type="button"
            onClick={load}
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-zinc-700 text-sm text-zinc-300 hover:bg-zinc-800"
          >
            <RefreshCw className="w-4 h-4" />
            Refresh
          </button>
        </div>
      </div>

      {error && (
        <div className="px-6 py-3 bg-red-500/10 border-b border-red-500/20 text-sm text-red-400">
          {error}
        </div>
      )}

      {recon && (
        <div
          className={`px-6 py-3 border-b text-sm ${
            recon.error || !recon.balanced
              ? 'bg-amber-500/10 border-amber-500/20 text-amber-300'
              : 'bg-emerald-500/10 border-emerald-500/20 text-emerald-300'
          }`}
        >
          {recon.error ? (
            recon.error
          ) : recon.balanced ? (
            <span className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4" />
              {recon.monthLabel}: all {recon.checked} payout(s) match the payment records.
            </span>
          ) : (
            <span className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4" />
              {recon.monthLabel}: {recon.mismatchCount} payout(s) disagree with the payment
              records — do not pay until resolved.
            </span>
          )}
        </div>
      )}

      {orphans?.unresolvedCount > 0 && (
        <div className="px-6 py-4 bg-red-500/10 border-b border-red-500/20">
          <p className="text-sm text-red-300 font-medium flex items-center gap-2 mb-3">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            {orphans.unresolvedCount} payment{orphans.unresolvedCount === 1 ? '' : 's'} could not be
            booked automatically ({formatRand(orphans.unresolvedCents)}) — these need manual
            settlement.
          </p>
          <ul className="space-y-2">
            {orphans.orphans.map((o) => (
              <li key={o.checkoutId} className="bg-zinc-900/60 rounded-lg px-3 py-2 text-xs">
                <div className="flex flex-wrap items-center gap-2 justify-between mb-2">
                  <span className="font-mono text-zinc-400">{o.checkoutId}</span>
                  <span className="text-zinc-400">{o.venueCode || 'unknown venue'}</span>
                  <span className="text-zinc-300">{o.reason}</span>
                  <span className="tabular-nums text-zinc-200 font-medium">
                    {o.amountRand ? `R${o.amountRand}` : '—'}
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    type="text"
                    value={orphanNotes[o.checkoutId] || ''}
                    onChange={(e) =>
                      setOrphanNotes((prev) => ({ ...prev, [o.checkoutId]: e.target.value }))
                    }
                    placeholder="How was this settled?"
                    aria-label={`Resolution note for ${o.checkoutId}`}
                    className="flex-1 min-w-[12rem] bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-1.5 text-zinc-100 placeholder:text-zinc-500"
                  />
                  <button
                    type="button"
                    disabled={!orphanNotes[o.checkoutId]?.trim()}
                    onClick={() => resolveOrphan(o.checkoutId)}
                    className="px-3 py-1.5 rounded-lg border border-zinc-600 text-zinc-200 hover:bg-zinc-800 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    Mark resolved
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {venues.length === 0 ? (
        <p className="px-6 py-6 text-sm text-zinc-500 flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-500" />
          Nothing outstanding — every venue is settled.
        </p>
      ) : (
        <ul className="divide-y divide-zinc-800">
          {venues.map((v) => {
            const open = expanded === v.venueCode;
            return (
              <li key={v.venueCode} className="text-sm">
                <button
                  type="button"
                  onClick={() => setExpanded(open ? null : v.venueCode)}
                  className="w-full flex items-center gap-3 px-6 py-3 text-left hover:bg-zinc-800/40"
                >
                  <ChevronRight
                    className={`w-4 h-4 text-zinc-500 shrink-0 transition-transform ${open ? 'rotate-90' : ''}`}
                  />
                  <span className="text-zinc-200 font-medium flex-1 truncate">{v.venueName}</span>
                  <span className="font-mono text-xs text-zinc-500">{v.venueCode}</span>
                  <span className="text-xs text-zinc-500">
                    {v.unpaidMonths} month{v.unpaidMonths === 1 ? '' : 's'}
                  </span>
                  <span className="text-emerald-400 font-semibold tabular-nums w-24 text-right">
                    {formatRand(v.outstandingCents)}
                  </span>
                </button>

                {open && (
                  <div className="px-12 pb-4 pt-1 space-y-3">
                    {v.bankDetails ? (
                      <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-xs text-zinc-400">
                        <dt className="text-zinc-500">Bank</dt>
                        <dd>{v.bankDetails.bankName}</dd>
                        <dt className="text-zinc-500">Account holder</dt>
                        <dd>{v.bankDetails.accountHolder}</dd>
                        <dt className="text-zinc-500">Account</dt>
                        <dd className="font-mono">{v.bankDetails.accountNumber}</dd>
                        <dt className="text-zinc-500">Branch</dt>
                        <dd className="font-mono">{v.bankDetails.branchCode}</dd>
                      </dl>
                    ) : (
                      <p className="text-xs text-amber-400 flex items-center gap-1.5">
                        <AlertTriangle className="w-3.5 h-3.5" />
                        No bank details on file — venue must add them before you can pay.
                      </p>
                    )}

                    <ul className="space-y-2">
                      {v.months.map((m) => (
                        <li
                          key={m.id}
                          className="flex flex-wrap items-center gap-2 justify-between bg-zinc-900/60 rounded-lg px-3 py-2"
                        >
                          <span className="text-zinc-300">
                            {m.monthLabel}
                            {m.status === 'failed' && (
                              <span className="ml-2 text-amber-400 text-xs">previously failed</span>
                            )}
                          </span>
                          <span className="tabular-nums text-zinc-200 font-medium">
                            {formatRand(m.venueAmountCents)}
                          </span>

                          {payingId === m.id ? (
                            <div className="flex flex-wrap items-center gap-2 w-full">
                              <input
                                type="text"
                                value={proofRef}
                                onChange={(e) => setProofRef(e.target.value)}
                                placeholder="EFT reference / proof of payment"
                                aria-label="Proof of payment reference"
                                className="flex-1 min-w-[12rem] bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-1.5 text-sm text-zinc-100 placeholder:text-zinc-500"
                              />
                              <button
                                type="button"
                                disabled={busy || !proofRef.trim()}
                                onClick={() => markMonthPaid(m.id)}
                                className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed"
                              >
                                {busy ? 'Saving…' : 'Confirm paid'}
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setPayingId(null);
                                  setProofRef('');
                                }}
                                className="px-3 py-1.5 rounded-lg border border-zinc-700 text-sm text-zinc-300 hover:bg-zinc-800"
                              >
                                Cancel
                              </button>
                            </div>
                          ) : (
                            <button
                              type="button"
                              onClick={() => {
                                setPayingId(m.id);
                                setProofRef('');
                                setError('');
                              }}
                              className="px-3 py-1.5 rounded-lg border border-emerald-600/40 text-emerald-400 text-sm hover:bg-emerald-600/10"
                            >
                              Mark paid
                            </button>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
