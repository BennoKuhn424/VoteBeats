import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Mail, Lock, Eye, EyeOff } from 'lucide-react';
import api from '../utils/api';
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
  const navigate = useNavigate();

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');

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
        const res = await api.register(email, password, venueName, location);
        localStorage.setItem('speeldit_logged_in', '1');
        localStorage.setItem('speeldit_venue_code', res.data.venueCode);
        navigate('/venue/dashboard');
      } else {
        const res = await api.login(email, password);
        localStorage.setItem('speeldit_logged_in', '1');
        if (res.data.role === 'owner') {
          localStorage.setItem('speeldit_role', 'owner');
          localStorage.removeItem('speeldit_venue_code');
          navigate('/owner');
        } else {
          localStorage.removeItem('speeldit_role');
          localStorage.setItem('speeldit_venue_code', res.data.venue?.code ?? res.data.venueCode);
          navigate('/venue/dashboard');
        }
      }
    } catch (err) {
      const msg = err.response?.data?.error || 'Something went wrong';
      const hint = (err.response?.status === 401 && msg.toLowerCase().includes('invalid'))
        ? ' If you registered elsewhere, try registering again on this server.'
        : '';
      setError(msg + hint);
    } finally {
      setLoading(false);
    }
  }

  const inputClass =
    'w-full min-h-touch pl-10 pr-10 py-3 bg-white border border-zinc-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500 text-zinc-900 placeholder:text-zinc-400';

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-zinc-50 to-zinc-100">
      <div className="w-full max-w-md px-4 py-8 sm:px-8">
        {/* Card Container */}
        <div className="bg-white rounded-xl shadow-xl border border-zinc-200 p-6 sm:p-8">
          {/* Logo */}
          <div className="flex justify-center mb-8">
            <Logo size="xl" />
          </div>

          {/* Welcome Text */}
          <div className="mb-8 text-center">
            <h2 className="text-xl font-semibold text-zinc-900 mb-2">
              {isRegister ? 'Register your venue' : 'Venue Login'}
            </h2>
            <p className="text-sm text-zinc-600">
              {isRegister
                ? 'Create an account to manage your venue'
                : 'Sign in to access your venue dashboard'}
            </p>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-5">
            {/* Email Field */}
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
                />
              </div>
            </div>

            {/* Register-only: Venue name & Location */}
            {isRegister && (
              <>
                <div className="space-y-2">
                  <label htmlFor="venueName" className="text-zinc-700 text-sm font-medium block">
                    Venue name
                  </label>
                  <input
                    id="venueName"
                    type="text"
                    value={venueName}
                    onChange={(e) => setVenueName(e.target.value)}
                    className="w-full min-h-touch px-4 py-3 bg-white border border-zinc-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500 text-zinc-900 placeholder:text-zinc-400"
                    placeholder="My Bar"
                    required
                    maxLength={100}
                  />
                </div>
                <div className="space-y-2">
                  <label htmlFor="location" className="text-zinc-700 text-sm font-medium block">
                    Location (optional)
                  </label>
                  <input
                    id="location"
                    type="text"
                    value={location}
                    onChange={(e) => setLocation(e.target.value)}
                    className="w-full min-h-touch px-4 py-3 bg-white border border-zinc-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500 text-zinc-900 placeholder:text-zinc-400"
                    placeholder="City or address"
                    maxLength={200}
                  />
                </div>
              </>
            )}

            {/* Password Field */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label htmlFor="password" className="text-zinc-700 text-sm font-medium block">
                  Password
                </label>
                {!isRegister && (
                  <button
                    type="button"
                    className="text-sm text-brand-600 hover:text-brand-700 transition-colors"
                  >
                    Forgot password?
                  </button>
                )}
              </div>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400 pointer-events-none" />
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
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-600 transition-colors"
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
              <p className="text-red-500 text-sm">{error}</p>
            )}

            {isRegister && (
              <p className="text-xs text-zinc-500 mt-4">
                By registering, you agree to our{' '}
                <Link to="/terms" className="text-brand-600 underline">Terms of Service</Link>{' '}
                and{' '}
                <Link to="/privacy" className="text-brand-600 underline">Privacy Policy</Link>.
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
              <div className="w-full border-t border-zinc-200" />
            </div>
            <div className="relative flex justify-center text-xs">
              <span className="bg-white px-2 text-zinc-500">
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
              }}
              className="text-sm text-zinc-700 hover:text-zinc-900 transition-colors"
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
            className="text-sm text-zinc-600 hover:text-zinc-900 transition-colors"
          >
            &larr; Back to Home
          </button>
          <div className="text-xs text-zinc-400 space-x-4">
            <Link to="/privacy" className="hover:text-zinc-600 transition-colors">Privacy Policy</Link>
            <Link to="/terms" className="hover:text-zinc-600 transition-colors">Terms of Service</Link>
          </div>
        </div>
      </div>
    </div>
  );
}
