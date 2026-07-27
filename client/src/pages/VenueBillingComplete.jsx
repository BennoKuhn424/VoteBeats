import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import api from '../utils/api';

/**
 * Landing page the billing provider redirects the venue to after checkout.
 *
 * Two provider styles come through here:
 *  - Verify-style (Paystack/Stripe): one /subscriptions/complete call verifies
 *    the card capture and creates the subscription immediately.
 *  - Webhook-style (PayFast): activation happens when the provider's ITN
 *    reaches our server, so /complete answers `pending_activation` and we poll
 *    until the webhook lands (usually seconds) or a timeout passes.
 */
const POLL_INTERVAL_MS = 3000;
const POLL_TIMEOUT_MS = 90 * 1000;

export default function VenueBillingComplete() {
  const [searchParams] = useSearchParams();
  const reference = searchParams.get('reference');
  const navigate = useNavigate();
  const [message, setMessage] = useState('Setting up your subscription…');
  const calledRef = useRef(false);

  useEffect(() => {
    if (calledRef.current) return;
    calledRef.current = true;

    if (!reference) {
      navigate('/venue/billing?status=missing_reference', { replace: true });
      return;
    }

    let alive = true;

    (async () => {
      const startedAt = Date.now();
      try {
        for (;;) {
          const r = await api.completeSubscription(reference);
          if (!alive) return;
          const status = r.data?.status;

          if (status === 'pending_activation') {
            setMessage('Waiting for your payment provider to confirm… this normally takes a few seconds.');
            if (Date.now() - startedAt > POLL_TIMEOUT_MS) {
              navigate('/venue/billing?status=pending', { replace: true });
              return;
            }
            await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
            if (!alive) return;
            continue;
          }

          // trialing / active / alreadyComplete — subscription is live.
          navigate('/venue/billing?status=active', { replace: true });
          return;
        }
      } catch (e) {
        if (!alive) return;
        const code = e.response?.data?.code;
        const statusMap = {
          AUTH_FAILED: 'auth_failed',
          CARD_NOT_REUSABLE: 'card_not_reusable',
          UNKNOWN_REFERENCE: 'unknown_reference',
          REFERENCE_MISMATCH: 'unknown_reference',
        };
        const qs = statusMap[code] || 'error';
        setMessage(e.response?.data?.error || 'Something went wrong.');
        setTimeout(() => { if (alive) navigate(`/venue/billing?status=${qs}`, { replace: true }); }, 1500);
      }
    })();

    return () => { alive = false; };
  }, [reference, navigate]);

  return (
    <div role="status" className="max-w-md mx-auto px-5 py-16 text-center text-zinc-600 dark:text-zinc-300 motion-safe:animate-fade-in">
      <div className="w-10 h-10 border-2 border-brand-500 border-t-transparent rounded-full animate-spin mx-auto mb-5" />
      <p>{message}</p>
    </div>
  );
}
