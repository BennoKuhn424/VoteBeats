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
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-zinc-50 to-zinc-100">
      <div className="w-full max-w-md px-4 py-8 sm:px-8">
        <div className="bg-white rounded-xl shadow-xl border border-zinc-200 p-6 sm:p-8 text-center">
          <div className="flex justify-center mb-6">
            <Logo size="xl" />
          </div>

          {status === 'loading' && (
            <>
              <Loader2 className="h-12 w-12 text-brand-500 animate-spin mx-auto mb-4" />
              <h2 className="text-xl font-semibold text-zinc-900 mb-2">Verifying your email...</h2>
              <p className="text-sm text-zinc-500">This will only take a moment.</p>
            </>
          )}

          {status === 'success' && (
            <>
              <CheckCircle className="h-12 w-12 text-green-500 mx-auto mb-4" />
              <h2 className="text-xl font-semibold text-zinc-900 mb-2">Email verified!</h2>
              <p className="text-sm text-zinc-600 mb-6">{message}</p>
              <Link
                to="/venue/login"
                className="inline-block px-6 py-3 bg-brand-600 text-white rounded-lg font-semibold hover:bg-brand-500 transition-colors"
              >
                Go to Login
              </Link>
            </>
          )}

          {status === 'error' && (
            <>
              <XCircle className="h-12 w-12 text-red-500 mx-auto mb-4" />
              <h2 className="text-xl font-semibold text-zinc-900 mb-2">Verification failed</h2>
              <p className="text-sm text-zinc-600 mb-6">{message}</p>
              <Link
                to="/venue/login"
                className="inline-block px-6 py-3 bg-brand-600 text-white rounded-lg font-semibold hover:bg-brand-500 transition-colors"
              >
                Back to Login
              </Link>
            </>
          )}

          {status === 'no-token' && (
            <>
              <XCircle className="h-12 w-12 text-zinc-400 mx-auto mb-4" />
              <h2 className="text-xl font-semibold text-zinc-900 mb-2">Invalid link</h2>
              <p className="text-sm text-zinc-600 mb-6">This verification link is missing or incomplete.</p>
              <Link
                to="/venue/login"
                className="inline-block px-6 py-3 bg-brand-600 text-white rounded-lg font-semibold hover:bg-brand-500 transition-colors"
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
