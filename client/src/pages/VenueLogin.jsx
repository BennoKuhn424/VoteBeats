import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Mail, Lock, Eye, EyeOff } from 'lucide-react';
import api from '../utils/api';
import { useAuth } from '../context/AuthContext';
import Button from '../components/shared/Button';
import Logo from '../components/shared/Logo';

export default function VenueLogin() {
  const [isRegister, setIsRegister] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [venueName, setVenueName] = useState('');
  const [location, setLocation] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [unverifiedEmail, setUnverifiedEmail] = useState('');
  const [resending, setResending] = useState(false);
  const navigate = useNavigate();
  const { login: authLogin } = useAuth();

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setInfo('');
    setUnverifiedEmail('');

    if (isRegister && password.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }
    if (isRegister && venueName.trim().length === 0) {
      setError('Venue name is required');
      return;
    }

    setLoading(true);

    try {
      if (isRegister) {
        await api.register(email, password, venueName, location);
        // Registration no longer auto-logs in — show verification message
        setInfo('Registration successful! Check your email for a verification link.');
        setIsRegister(false);
        setPassword('');
      } else {
        const res = await api.login(email, password);
        authLogin(res.data);
        if (res.data.role === 'owner') {
          navigate('/owner');
        } else {
          navigate('/venue/dashboard');
        }
      }
    } catch (err) {
      const code = err.response?.data?.code;
      const msg = err.response?.data?.error || 'Something went wrong';

      if (code === 'AUTH_EMAIL_NOT_VERIFIED') {
        setUnverifiedEmail(err.response?.data?.email || email);
        setError(msg);
      } else {
        const hint = (err.response?.status === 401 && msg.toLowerCase().includes('invalid'))
          ? ' If you registered elsewhere, try registering again on this server.'
          : '';
        setError(msg + hint);
      }
    } finally {
      setLoading(false);
    }
  }

  async function handleResendVerification() {
    if (!unverifiedEmail) return;
    setResending(true);
    try {
      await api.resendVerification(unverifiedEmail);
      setInfo('Verification email sent! Check your inbox.');
      setError('');
      setUnverifiedEmail('');
    } catch {
      setError('Could not resend verification email. Please try again.');
    } finally {
      setResending(false);
    }
  }

  const inputClass =
    'w-full min-h-touch pl-10 pr-10 py-3 bg-white dark:bg-dark-700 border border-zinc-300 dark:border-dark-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500 text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 dark:placeholder:text-zinc-500';
  const plainInputClass =
    'w-full min-h-touch px-4 py-3 bg-white dark:bg-dark-700 border border-zinc-300 dark:border-dark-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500 text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 dark:placeholder:text-zinc-500';

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-zinc-50 to-zinc-100 dark:from-dark-950 dark:to-dark-900">
      <div className="w-full max-w-md px-4 py-8 sm:px-8">
        {/* Card Container */}
        <div className="bg-white dark:bg-dark-800 rounded-xl shadow-xl border border-zinc-200 dark:border-dark-600 p-6 sm:p-8">
          {/* Logo */}
          <div className="flex justify-center mb-8">
            <Logo size="xl" />
          </div>

          {/* Welcome Text */}
          <div className="mb-8 text-center">
            <h2 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100 mb-2">
              {isRegister ? 'Register your venue' : 'Venue Login'}
            </h2>
            <p className="text-sm text-zinc-600 dark:text-zinc-300">
              {isRegister
                ? 'Create an account to manage your venue'
                : 'Sign in to access your venue dashboard'}
            </p>
          </div>

          {/* Success / info banner */}
          {info && (
            <div className="mb-5 p-3 rounded-lg bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-900/50">
              <p className="text-sm text-green-800 dark:text-green-300">{info}</p>
            </div>
          )}

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-5">
            {/* Email Field */}
            <div className="space-y-2">
              <label htmlFor="email" className="text-zinc-700 dark:text-zinc-200 text-sm font-medium block">
                Email Address
              </label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400 dark:text-zinc-500 pointer-events-none" />
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
                />
              </div>
            </div>

            {/* Register-only: Venue name & Location */}
            {isRegister && (
              <>
                <div className="space-y-2">
                  <label htmlFor="venueName" className="text-zinc-700 dark:text-zinc-200 text-sm font-medium block">
                    Venue name
                  </label>
                  <input
                    id="venueName"
                    type="text"
                    value={venueName}
                    onChange={(e) => setVenueName(e.target.value)}
                    className={plainInputClass}
                    placeholder="My Bar"
                    required
                    maxLength={100}
                  />
                </div>
                <div className="space-y-2">
                  <label htmlFor="location" className="text-zinc-700 dark:text-zinc-200 text-sm font-medium block">
                    Location (optional)
                  </label>
                  <input
                    id="location"
                    type="text"
                    value={location}
                    onChange={(e) => setLocation(e.target.value)}
                    className={plainInputClass}
                    placeholder="City or address"
                    maxLength={200}
                  />
                </div>
              </>
            )}

            {/* Password Field */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label htmlFor="password" className="text-zinc-700 dark:text-zinc-200 text-sm font-medium block">
                  Password
                </label>
                {!isRegister && (
                  <Link
                    to="/forgot-password"
                    className="text-sm text-brand-600 hover:text-brand-700 transition-colors"
                  >
                    Forgot password?
                  </Link>
                )}
              </div>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400 dark:text-zinc-500 pointer-events-none" />
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className={inputClass}
                  placeholder="Enter your password"
                  required
                  maxLength={128}
                  minLength={isRegister ? 8 : 1}
                  autoComplete={isRegister ? 'new-password' : 'current-password'}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 dark:text-zinc-500 hover:text-zinc-600 dark:hover:text-zinc-200 transition-colors"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </button>
              </div>
            </div>

            {error && (
              <div>
                <p className="text-red-500 dark:text-red-400 text-sm">{error}</p>
                {unverifiedEmail && (
                  <button
                    type="button"
                    onClick={handleResendVerification}
                    disabled={resending}
                    className="mt-2 text-sm text-brand-600 dark:text-brand-400 hover:text-brand-700 dark:hover:text-brand-300 font-medium underline"
                  >
                    {resending ? 'Sending...' : 'Resend verification email'}
                  </button>
                )}
              </div>
            )}

            {isRegister && (
              <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-4">
                By registering, you agree to our{' '}
                <Link to="/terms" className="text-brand-600 dark:text-brand-400 underline">Terms of Service</Link>{' '}
                and{' '}
                <Link to="/privacy" className="text-brand-600 dark:text-brand-400 underline">Privacy Policy</Link>.
              </p>
            )}

            {/* Login/Register Button */}
            <Button
              type="submit"
              disabled={loading}
              className="w-full !py-3 !h-11 bg-brand-600 hover:!bg-brand-500 !text-white font-medium mt-6"
            >
              {loading ? 'Please wait...' : isRegister ? 'Register' : 'Sign In'}
            </Button>
          </form>

          {/* Divider */}
          <div className="relative my-6">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-zinc-200 dark:border-dark-600" />
            </div>
            <div className="relative flex justify-center text-xs">
              <span className="bg-white dark:bg-dark-800 px-2 text-zinc-500 dark:text-zinc-400">
                {isRegister ? 'Already have an account?' : 'New to Speeldit?'}
              </span>
            </div>
          </div>

          {/* Toggle Login/Register */}
          <div className="text-center">
            <button
              type="button"
              onClick={() => {
                setIsRegister(!isRegister);
                setError('');
                setInfo('');
                setUnverifiedEmail('');
              }}
              className="text-sm text-zinc-700 dark:text-zinc-200 hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors"
            >
              {isRegister ? 'Log in instead' : 'Create a venue account'}
            </button>
          </div>
        </div>

        {/* Footer Links */}
        <div className="mt-6 text-center space-y-2">
          <button
            type="button"
            onClick={() => navigate('/')}
            className="text-sm text-zinc-600 dark:text-zinc-300 hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors"
          >
            &larr; Back to Home
          </button>
          <div className="text-xs text-zinc-400 dark:text-zinc-500 space-x-4">
            <Link to="/privacy" className="hover:text-zinc-600 dark:hover:text-zinc-200 transition-colors">Privacy Policy</Link>
            <Link to="/terms" className="hover:text-zinc-600 dark:hover:text-zinc-200 transition-colors">Terms of Service</Link>
          </div>
        </div>
      </div>
    </div>
  );
}
