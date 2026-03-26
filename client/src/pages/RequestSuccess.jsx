import { useState, useEffect } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import api from '../utils/api';

export default function RequestSuccess() {
  const { venueCode } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [status, setStatus] = useState('checking'); // checking | success | timeout
  const [checkoutId, setCheckoutId] = useState(null);

  useEffect(() => {
    const storageKey = `speeldit_checkout_${venueCode}`;
    const fromUrl = searchParams.get('checkoutId');
    const fromSession = sessionStorage.getItem(storageKey);
    const fromLocal = localStorage.getItem(storageKey);
    const fromCookie = document.cookie
      .split('; ')
      .find((row) => row.startsWith(`${storageKey}=`))
      ?.split('=')[1];
    const id = fromUrl || fromSession || fromLocal || fromCookie;
    if (id) {
      setCheckoutId(id);
      sessionStorage.removeItem(storageKey);
      localStorage.removeItem(storageKey);
      document.cookie = `${storageKey}=; path=/; max-age=0`;
    } else {
      setStatus('timeout');
    }
  }, [venueCode, searchParams]);

  useEffect(() => {
    if (!checkoutId || !venueCode) return;

    let attempts = 0;
    const maxAttempts = 15;
    let cancelled = false;
    const inFlight = { current: false };

    const check = async () => {
      if (inFlight.current) return false;
      inFlight.current = true;
      try {
        try {
          const res = await api.getRequestStatus(venueCode, checkoutId);
          if (res.data?.fulfilled) {
            if (!cancelled) setStatus('success');
            return true;
          }
        } catch {
          // Ignore
        }
        attempts++;
        if (attempts >= maxAttempts) {
          if (!cancelled) setStatus('timeout');
          return true;
        }
        return false;
      } finally {
        inFlight.current = false;
      }
    };

    const interval = setInterval(() => {
      check().then((done) => {
        if (done) clearInterval(interval);
      });
    }, 500);

    check().then((done) => {
      if (done) clearInterval(interval);
    });

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [checkoutId, venueCode]);

  return (
    <div className="min-h-screen bg-dark-950 text-white flex justify-center items-center px-5 pb-safe">
      <div className="text-center max-w-sm">
        {status === 'checking' && (
          <>
            <div className="w-16 h-16 border-2 border-brand-500 border-t-transparent rounded-full animate-spin mx-auto mb-6" />
            <h1 className="text-xl font-bold mb-2">Payment successful!</h1>
            <p className="text-dark-400">Adding your song to the queue...</p>
          </>
        )}
        {status === 'success' && (
          <>
            <div className="w-20 h-20 rounded-full bg-emerald-500 flex items-center justify-center text-4xl mx-auto mb-6">✓</div>
            <h1 className="text-2xl font-bold mb-2">Song added!</h1>
            <p className="text-dark-400 mb-8">Your song is in the queue. Enjoy the vibe!</p>
            <button
              onClick={() => navigate(`/v/${venueCode}`)}
              className="min-h-touch px-8 py-4 bg-brand-500 rounded-xl font-semibold hover:bg-brand-400 transition-colors w-full"
            >
              Back to voting
            </button>
          </>
        )}
        {status === 'timeout' && (
          <>
            <div className="text-5xl mb-6">⏳</div>
            <h1 className="text-xl font-bold mb-2">Almost there</h1>
            <p className="text-dark-400 mb-8">
              Your payment went through. If your song doesn&apos;t appear in a moment, refresh the voting page or check back soon. Your song will be added once the payment is confirmed.
            </p>
            <button
              onClick={() => navigate(`/v/${venueCode}`)}
              className="min-h-touch px-8 py-4 bg-brand-500 rounded-xl font-semibold hover:bg-brand-400 transition-colors w-full"
            >
              Back to voting
            </button>
          </>
        )}
      </div>
    </div>
  );
}
