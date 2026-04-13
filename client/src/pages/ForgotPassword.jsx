import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Mail, ArrowLeft } from 'lucide-react';
import api from '../utils/api';
import Button from '../components/shared/Button';
import Logo from '../components/shared/Logo';

export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await api.forgotPassword(email);
      setSent(true);
    } catch (err) {
      setError(err.response?.data?.error || 'Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  const inputClass =
    'w-full min-h-touch pl-10 pr-4 py-3 bg-white border border-zinc-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500 text-zinc-900 placeholder:text-zinc-400';

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-zinc-50 to-zinc-100">
      <div className="w-full max-w-md px-4 py-8 sm:px-8">
        <div className="bg-white rounded-xl shadow-xl border border-zinc-200 p-6 sm:p-8">
          <div className="flex justify-center mb-6">
            <Logo size="xl" />
          </div>

          {sent ? (
            <div className="text-center">
              <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <Mail className="h-6 w-6 text-green-600" />
              </div>
              <h2 className="text-xl font-semibold text-zinc-900 mb-2">Check your email</h2>
              <p className="text-sm text-zinc-600 mb-6">
                If an account exists with <strong>{email}</strong>, we've sent a password reset link. It expires in 1 hour.
              </p>
              <p className="text-xs text-zinc-500 mb-6">
                Don't see it? Check your spam folder.
              </p>
              <Link
                to="/venue/login"
                className="inline-flex items-center gap-1.5 text-sm text-brand-600 hover:text-brand-700 font-medium"
              >
                <ArrowLeft className="h-4 w-4" />
                Back to Login
              </Link>
            </div>
          ) : (
            <>
              <div className="mb-6 text-center">
                <h2 className="text-xl font-semibold text-zinc-900 mb-2">Forgot your password?</h2>
                <p className="text-sm text-zinc-600">
                  Enter your email and we'll send you a link to reset your password.
                </p>
              </div>

              <form onSubmit={handleSubmit} className="space-y-5">
                <div className="space-y-2">
                  <label htmlFor="email" className="text-zinc-700 text-sm font-medium block">
                    Email Address
                  </label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400 pointer-events-none" />
                    <input
                      id="email"
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className={inputClass}
                      placeholder="your@email.com"
                      required
                      maxLength={254}
                      autoComplete="email"
                      autoFocus
                    />
                  </div>
                </div>

                {error && <p className="text-red-500 text-sm">{error}</p>}

                <Button
                  type="submit"
                  disabled={loading || sent}
                  className="w-full !py-3 !h-11 bg-brand-600 hover:!bg-brand-500 !text-white font-medium"
                >
                  {loading ? 'Sending...' : 'Send reset link'}
                </Button>
              </form>

              <div className="mt-6 text-center">
                <Link
                  to="/venue/login"
                  className="inline-flex items-center gap-1.5 text-sm text-zinc-600 hover:text-zinc-900"
                >
                  <ArrowLeft className="h-4 w-4" />
                  Back to Login
                </Link>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
