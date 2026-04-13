import { useState } from 'react';
import { useSearchParams, Link, useNavigate } from 'react-router-dom';
import { Lock, Eye, EyeOff, CheckCircle, XCircle } from 'lucide-react';
import api from '../utils/api';
import Button from '../components/shared/Button';
import Logo from '../components/shared/Logo';

export default function ResetPassword() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');

  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');

    if (password.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    setLoading(true);
    try {
      await api.resetPassword(token, password);
      setSuccess(true);
      // Clear the token from the URL so it can't be accidentally shared
      navigate('/reset-password', { replace: true });
    } catch (err) {
      setError(err.response?.data?.error || 'Something went wrong. The link may be invalid or expired.');
    } finally {
      setLoading(false);
    }
  }

  const inputClass =
    'w-full min-h-touch pl-10 pr-10 py-3 bg-white border border-zinc-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500 text-zinc-900 placeholder:text-zinc-400';

  if (!token) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-zinc-50 to-zinc-100">
        <div className="w-full max-w-md px-4 py-8 sm:px-8">
          <div className="bg-white rounded-xl shadow-xl border border-zinc-200 p-6 sm:p-8 text-center">
            <div className="flex justify-center mb-6"><Logo size="xl" /></div>
            <XCircle className="h-12 w-12 text-zinc-400 mx-auto mb-4" />
            <h2 className="text-xl font-semibold text-zinc-900 mb-2">Invalid link</h2>
            <p className="text-sm text-zinc-600 mb-6">This reset link is missing or incomplete.</p>
            <Link to="/venue/login" className="inline-block px-6 py-3 bg-brand-600 text-white rounded-lg font-semibold hover:bg-brand-500 transition-colors">
              Back to Login
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-zinc-50 to-zinc-100">
      <div className="w-full max-w-md px-4 py-8 sm:px-8">
        <div className="bg-white rounded-xl shadow-xl border border-zinc-200 p-6 sm:p-8">
          <div className="flex justify-center mb-6">
            <Logo size="xl" />
          </div>

          {success ? (
            <div className="text-center">
              <CheckCircle className="h-12 w-12 text-green-500 mx-auto mb-4" />
              <h2 className="text-xl font-semibold text-zinc-900 mb-2">Password reset!</h2>
              <p className="text-sm text-zinc-600 mb-6">You can now log in with your new password.</p>
              <Link
                to="/venue/login"
                className="inline-block px-6 py-3 bg-brand-600 text-white rounded-lg font-semibold hover:bg-brand-500 transition-colors"
              >
                Go to Login
              </Link>
            </div>
          ) : (
            <>
              <div className="mb-6 text-center">
                <h2 className="text-xl font-semibold text-zinc-900 mb-2">Set a new password</h2>
                <p className="text-sm text-zinc-600">Choose a strong password for your account.</p>
              </div>

              <form onSubmit={handleSubmit} className="space-y-5">
                <div className="space-y-2">
                  <label htmlFor="password" className="text-zinc-700 text-sm font-medium block">
                    New Password
                  </label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400 pointer-events-none" />
                    <input
                      id="password"
                      type={showPassword ? 'text' : 'password'}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className={inputClass}
                      placeholder="At least 8 characters"
                      required
                      minLength={8}
                      maxLength={128}
                      autoComplete="new-password"
                      autoFocus
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-600"
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                    >
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>

                <div className="space-y-2">
                  <label htmlFor="confirmPassword" className="text-zinc-700 text-sm font-medium block">
                    Confirm Password
                  </label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400 pointer-events-none" />
                    <input
                      id="confirmPassword"
                      type={showPassword ? 'text' : 'password'}
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      className={inputClass}
                      placeholder="Repeat your password"
                      required
                      minLength={8}
                      maxLength={128}
                      autoComplete="new-password"
                    />
                  </div>
                </div>

                {error && <p className="text-red-500 text-sm">{error}</p>}

                <Button
                  type="submit"
                  disabled={loading || success}
                  className="w-full !py-3 !h-11 bg-brand-600 hover:!bg-brand-500 !text-white font-medium"
                >
                  {loading ? 'Resetting...' : 'Reset password'}
                </Button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
