import { useState, useEffect } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { CheckCircle, XCircle, Loader2 } from 'lucide-react';
import api from '../utils/api';
import Logo from '../components/shared/Logo';

export default function VerifyEmail() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');
  const [status, setStatus] = useState('loading'); // loading | success | error | no-token
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!token) {
      setStatus('no-token');
      return;
    }

    api.verifyEmail(token)
      .then((res) => {
        setStatus('success');
        setMessage(res.data.message || 'Email verified successfully!');
      })
      .catch((err) => {
        setStatus('error');
        setMessage(err.response?.data?.error || 'Verification failed. The link may be invalid or expired.');
      });
  }, [token]);

  return (
    <div className="relative min-h-screen flex items-center justify-center overflow-hidden bg-gradient-to-br from-zinc-50 to-zinc-100 dark:from-dark-950 dark:to-dark-900">
      <div aria-hidden="true" className="pointer-events-none absolute -top-24 left-1/2 h-72 w-72 -translate-x-1/2 rounded-full bg-brand-500/10 blur-3xl" />
      <div className="relative w-full max-w-md px-4 py-8 sm:px-8">
        <div className="bg-white dark:bg-dark-800 rounded-2xl shadow-elevated border border-zinc-200/80 dark:border-dark-600 p-6 sm:p-8 text-center motion-safe:animate-scale-in">
          <div className="flex justify-center mb-6">
            <Logo size="xl" />
          </div>

          {status === 'loading' && (
            <div role="status">
              <Loader2 className="h-12 w-12 text-brand-500 animate-spin mx-auto mb-4" />
              <h2 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100 mb-2">Verifying your email...</h2>
              <p className="text-sm text-zinc-500 dark:text-zinc-400">This will only take a moment.</p>
            </div>
          )}

          {status === 'success' && (
            <>
              <CheckCircle className="h-12 w-12 text-green-500 mx-auto mb-4" />
              <h2 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100 mb-2">Email verified!</h2>
              <p className="text-sm text-zinc-600 dark:text-zinc-300 mb-6">{message}</p>
              <Link
                to="/venue/login"
                className="inline-flex items-center justify-center min-h-touch px-6 py-3 bg-brand-500 text-white rounded-xl font-semibold shadow-glow-brand hover:bg-brand-400 hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.97] transition-all duration-300 ease-spring"
              >
                Go to Login
              </Link>
            </>
          )}

          {status === 'error' && (
            <>
              <XCircle className="h-12 w-12 text-red-500 mx-auto mb-4" />
              <h2 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100 mb-2">Verification failed</h2>
              <p className="text-sm text-zinc-600 dark:text-zinc-300 mb-6">{message}</p>
              <Link
                to="/venue/login"
                className="inline-flex items-center justify-center min-h-touch px-6 py-3 bg-brand-500 text-white rounded-xl font-semibold shadow-glow-brand hover:bg-brand-400 hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.97] transition-all duration-300 ease-spring"
              >
                Back to Login
              </Link>
            </>
          )}

          {status === 'no-token' && (
            <>
              <XCircle className="h-12 w-12 text-zinc-400 dark:text-zinc-500 mx-auto mb-4" />
              <h2 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100 mb-2">Invalid link</h2>
              <p className="text-sm text-zinc-600 dark:text-zinc-300 mb-6">This verification link is missing or incomplete.</p>
              <Link
                to="/venue/login"
                className="inline-flex items-center justify-center min-h-touch px-6 py-3 bg-brand-500 text-white rounded-xl font-semibold shadow-glow-brand hover:bg-brand-400 hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.97] transition-all duration-300 ease-spring"
              >
                Back to Login
              </Link>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
