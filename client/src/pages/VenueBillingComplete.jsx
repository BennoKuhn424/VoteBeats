import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import api from '../utils/api';

/**
 * Landing page Paystack redirects the venue to after card authorisation.
 * Calls POST /subscriptions/complete to verify and create the subscription,
 * then redirects to /venue/billing with a status query string.
 */
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

    (async () => {
      try {
        await api.completeSubscription(reference);
        navigate('/venue/billing?status=active', { replace: true });
      } catch (e) {
        const code = e.response?.data?.code;
        const statusMap = {
          AUTH_FAILED: 'auth_failed',
          CARD_NOT_REUSABLE: 'card_not_reusable',
          UNKNOWN_REFERENCE: 'unknown_reference',
          REFERENCE_MISMATCH: 'unknown_reference',
        };
        const qs = statusMap[code] || 'error';
        setMessage(e.response?.data?.error || 'Something went wrong.');
        setTimeout(() => navigate(`/venue/billing?status=${qs}`, { replace: true }), 1500);
      }
    })();
  }, [reference, navigate]);

  return (
    <div className="max-w-md mx-auto px-5 py-16 text-center text-zinc-600 dark:text-zinc-300">
      <div className="animate-pulse mb-4 text-zinc-400 dark:text-zinc-500">•••</div>
      <p>{message}</p>
    </div>
  );
}
