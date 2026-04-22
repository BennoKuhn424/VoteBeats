import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import api from '../utils/api';

const STATUS_LABELS = {
  none: { label: 'No subscription', color: 'text-zinc-600' },
  trialing: { label: 'Free trial', color: 'text-emerald-600' },
  active: { label: 'Active', color: 'text-emerald-600' },
  past_due: { label: 'Payment failed', color: 'text-red-600' },
  canceled: { label: 'Canceled', color: 'text-zinc-500' },
  incomplete: { label: 'Setup incomplete', color: 'text-amber-600' },
};

function formatDate(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleDateString('en-ZA', {
    day: 'numeric', month: 'long', year: 'numeric',
  });
}

export default function VenueBilling() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [sub, setSub] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [banner, setBanner] = useState(null);
  const [starting, setStarting] = useState(false);
  const [canceling, setCanceling] = useState(false);

  const callbackStatus = searchParams.get('status');

  useEffect(() => {
    if (!callbackStatus) return;
    const map = {
      active: { tone: 'success', text: 'Your trial is live. You won\'t be charged until the trial ends.' },
      auth_failed: { tone: 'error', text: 'Card authorisation failed. Please try again with a different card.' },
      card_not_reusable: { tone: 'error', text: 'This card can\'t be saved for recurring billing. Please try another.' },
      missing_reference: { tone: 'error', text: 'Something went wrong during the redirect. Please try again.' },
      unknown_reference: { tone: 'error', text: 'We couldn\'t match this transaction to your account. Please contact support.' },
      error: { tone: 'error', text: 'An error occurred while setting up your subscription. Please try again.' },
    };
    setBanner(map[callbackStatus] || null);
    // Clean the URL so the banner doesn't reappear on refresh.
    searchParams.delete('status');
    setSearchParams(searchParams, { replace: true });
  }, [callbackStatus, searchParams, setSearchParams]);

  useEffect(() => {
    let alive = true;
    api.getSubscription()
      .then((r) => { if (alive) { setSub(r.data); setLoading(false); } })
      .catch((e) => {
        if (!alive) return;
        setError(e.response?.data?.error || 'Failed to load subscription');
        setLoading(false);
      });
    return () => { alive = false; };
  }, []);

  async function handleStart() {
    setStarting(true);
    setError('');
    try {
      const r = await api.startSubscription();
      window.location.assign(r.data.authorizationUrl);
    } catch (e) {
      setStarting(false);
      setError(e.response?.data?.error || 'Could not start subscription');
    }
  }

  async function handleManage() {
    try {
      const r = await api.getSubscriptionManageLink();
      window.open(r.data.link, '_blank', 'noopener');
    } catch (e) {
      setError(e.response?.data?.error || 'Could not open manage link');
    }
  }

  async function handleCancel() {
    if (!confirm('Cancel your subscription? You\'ll lose dashboard access at the end of the current period.')) return;
    setCanceling(true);
    setError('');
    try {
      await api.cancelSubscription();
      const r = await api.getSubscription();
      setSub(r.data);
    } catch (e) {
      setError(e.response?.data?.error || 'Could not cancel subscription');
    } finally {
      setCanceling(false);
    }
  }

  if (loading) {
    return <div className="max-w-2xl mx-auto px-5 py-12 text-zinc-500">Loading billing…</div>;
  }

  const status = sub?.status || 'none';
  const info = STATUS_LABELS[status] || STATUS_LABELS.none;
  const amountZar = sub?.amountZar ?? 599;
  const trialDays = sub?.trialDays ?? 14;

  const showStartButton = status === 'none' || status === 'incomplete' || status === 'canceled';
  const showManageCancel = status === 'trialing' || status === 'active' || status === 'past_due';

  return (
    <div className="max-w-2xl mx-auto px-5 py-10">
      <h1 className="text-2xl font-bold mb-1">Billing</h1>
      <p className="text-zinc-500 text-sm mb-6">Manage your Speeldit subscription.</p>

      {banner && (
        <div className={`mb-6 rounded-lg border p-4 text-sm ${
          banner.tone === 'success'
            ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
            : 'border-red-200 bg-red-50 text-red-800'
        }`}>
          {banner.text}
        </div>
      )}

      {error && (
        <div className="mb-6 rounded-lg border border-red-200 bg-red-50 text-red-800 p-4 text-sm">
          {error}
        </div>
      )}

      <div className="rounded-xl border border-zinc-200 bg-white p-6 mb-6">
        <div className="flex items-start justify-between mb-4">
          <div>
            <div className="text-xs uppercase tracking-wide text-zinc-500">Status</div>
            <div className={`text-xl font-semibold ${info.color}`}>{info.label}</div>
          </div>
          <div className="text-right">
            <div className="text-xs uppercase tracking-wide text-zinc-500">Monthly price</div>
            <div className="text-xl font-semibold text-zinc-900">R{amountZar}</div>
          </div>
        </div>

        {status === 'trialing' && sub?.trialEndsAt && (
          <div className="rounded-lg bg-zinc-50 p-4 text-sm text-zinc-700 mb-4">
            <strong>Your trial ends on {formatDate(sub.trialEndsAt)}.</strong><br />
            On that date we'll charge R{amountZar} to your card and every month after.
            Cancel any time before then and you won't be charged.
          </div>
        )}

        {status === 'active' && sub?.currentPeriodEnd && (
          <div className="text-sm text-zinc-600 mb-4">
            Next billing date: <strong>{formatDate(sub.currentPeriodEnd)}</strong>
          </div>
        )}

        {status === 'past_due' && (
          <div className="rounded-lg bg-red-50 p-4 text-sm text-red-800 mb-4">
            Your last payment failed. Please update your card to keep your dashboard active.
          </div>
        )}

        {showStartButton && (
          <>
            <div className="rounded-lg bg-brand-50 p-4 text-sm text-zinc-800 mb-4">
              <p className="font-semibold mb-2">What you're signing up for:</p>
              <ul className="list-disc pl-5 space-y-1">
                <li><strong>{trialDays}-day free trial</strong> — no charge during the trial</li>
                <li>Then <strong>R{amountZar}/month</strong>, billed automatically to your card until you cancel</li>
                <li>Cancel anytime from this page. Cancelling during the trial means no charge.</li>
                <li>
                  Song request payments at your venue (if enabled): <strong>70% paid to you</strong> monthly by EFT,
                  30% kept by Speeldit.
                </li>
              </ul>
            </div>
            <p className="text-xs text-zinc-500 mb-4">
              By continuing you accept the <Link to="/terms" className="text-brand-600 hover:underline">Terms of Service</Link>.
            </p>
            <button
              onClick={handleStart}
              disabled={starting}
              className="w-full rounded-lg bg-brand-600 hover:bg-brand-700 text-white font-semibold py-3 disabled:opacity-50"
            >
              {starting ? 'Redirecting to Paystack…' : `Start ${trialDays}-day free trial`}
            </button>
          </>
        )}

        {showManageCancel && (
          <div className="flex flex-col sm:flex-row gap-3">
            <button
              onClick={handleManage}
              className="flex-1 rounded-lg bg-zinc-100 hover:bg-zinc-200 text-zinc-800 font-semibold py-3"
            >
              Update payment method
            </button>
            <button
              onClick={handleCancel}
              disabled={canceling}
              className="flex-1 rounded-lg bg-white border border-red-300 hover:bg-red-50 text-red-700 font-semibold py-3 disabled:opacity-50"
            >
              {canceling ? 'Cancelling…' : 'Cancel subscription'}
            </button>
          </div>
        )}
      </div>

      <p className="text-xs text-zinc-500">
        Payments processed by Paystack. Speeldit never sees or stores your card details.
      </p>
    </div>
  );
}
