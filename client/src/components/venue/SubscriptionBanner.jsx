import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertCircle, Clock, XCircle, CreditCard } from 'lucide-react';
import api from '../../utils/api';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Surfaces subscription status on the venue dashboard (Rockbot-style).
 *
 * - Trialing with <=3 days left → amber "X days left" + upgrade CTA
 * - Active → hidden (no noise when everything is fine)
 * - past_due / canceled / incomplete / none → red block with billing CTA
 */
export default function SubscriptionBanner() {
  const [sub, setSub] = useState(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let alive = true;
    api.getSubscription()
      .then((r) => { if (alive) { setSub(r.data); setLoaded(true); } })
      .catch(() => { if (alive) setLoaded(true); });
    return () => { alive = false; };
  }, []);

  if (!loaded || !sub) return null;

  const status = sub.status || 'none';
  const trialEndsAt = sub.trialEndsAt || null;
  const daysLeft = trialEndsAt ? Math.max(0, Math.ceil((trialEndsAt - Date.now()) / DAY_MS)) : null;

  if (status === 'active') return null;
  if (status === 'trialing' && daysLeft !== null && daysLeft > 3) return null;

  const map = {
    trialing: {
      tone: 'amber',
      Icon: Clock,
      title: `Free trial ends in ${daysLeft ?? 0} day${daysLeft === 1 ? '' : 's'}`,
      body: `On the trial-end date we'll start billing R${sub.amountZar ?? 599}/month. You can cancel any time before then.`,
      cta: 'Manage billing',
    },
    past_due: {
      tone: 'red',
      Icon: AlertCircle,
      title: 'Payment failed',
      body: 'Your last subscription payment did not go through. Update your card to keep your dashboard active.',
      cta: 'Update payment',
    },
    canceled: {
      tone: 'red',
      Icon: XCircle,
      title: 'Subscription canceled',
      body: 'Reactivate to keep accepting requests and managing your queue.',
      cta: 'Reactivate',
    },
    incomplete: {
      tone: 'amber',
      Icon: AlertCircle,
      title: 'Finish setting up billing',
      body: 'We started your subscription but the card authorisation did not complete.',
      cta: 'Finish setup',
    },
    none: {
      tone: 'red',
      Icon: CreditCard,
      title: 'Start your 14-day free trial',
      body: `Speeldit is R${sub.amountZar ?? 599}/month after a 14-day free trial. You won't be charged during the trial.`,
      cta: 'Start trial',
    },
  };

  const info = map[status] || map.none;
  const tone = info.tone === 'red'
    ? 'border-red-200 dark:border-red-900/50 bg-red-50 dark:bg-red-950/30 text-red-800 dark:text-red-200'
    : 'border-amber-200 dark:border-amber-900/50 bg-amber-50 dark:bg-amber-950/30 text-amber-900 dark:text-amber-200';
  const btn = info.tone === 'red'
    ? 'bg-red-600 hover:bg-red-700 text-white'
    : 'bg-amber-600 hover:bg-amber-700 text-white';

  const { Icon } = info;

  return (
    <div className={`rounded-xl border ${tone} p-4 mb-6 flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between`}>
      <div className="flex items-start gap-3 min-w-0">
        <Icon className="h-5 w-5 shrink-0 mt-0.5" />
        <div className="min-w-0">
          <p className="font-semibold text-sm">{info.title}</p>
          <p className="text-sm opacity-90">{info.body}</p>
        </div>
      </div>
      <Link
        to="/venue/billing"
        className={`inline-flex items-center justify-center px-4 py-2.5 rounded-lg text-sm font-semibold shrink-0 min-h-[44px] ${btn}`}
      >
        {info.cta}
      </Link>
    </div>
  );
}
