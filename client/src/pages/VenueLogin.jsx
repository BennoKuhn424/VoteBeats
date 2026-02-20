import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../utils/api';
import Button from '../components/shared/Button';
import Header from '../components/shared/Header';

export default function VenueLogin() {
  const [isRegister, setIsRegister] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [venueName, setVenueName] = useState('');
  const [location, setLocation] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const navigate = useNavigate();

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      if (isRegister) {
        const res = await api.register(email, password, venueName, location);
        localStorage.setItem('votebeats_token', res.data.token);
        localStorage.setItem('votebeats_venue_code', res.data.venueCode);
        navigate('/venue/dashboard');
      } else {
        const res = await api.login(email, password);
        localStorage.setItem('votebeats_token', res.data.token);
        localStorage.setItem('votebeats_venue_code', res.data.venue?.code ?? res.data.venueCode);
        navigate('/venue/dashboard');
      }
    } catch (err) {
      setError(err.response?.data?.error || 'Something went wrong');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-dark-950 text-white pb-safe">
      <Header />
      <div className="container mx-auto px-5 py-10 max-w-md">
        <h1 className="text-2xl font-extrabold mb-8 text-center tracking-tight">
          {isRegister ? 'Register your venue' : 'Venue login'}
        </h1>

        <form onSubmit={handleSubmit} className="space-y-5">
          {isRegister ? (
            <>
              <div>
                <label className="block text-sm font-medium text-dark-400 mb-2">Email</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  className="w-full min-h-touch px-4 py-3 bg-dark-800 border border-dark-600 rounded-xl focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-dark-400 mb-2">Venue name</label>
                <input
                  type="text"
                  value={venueName}
                  onChange={(e) => setVenueName(e.target.value)}
                  required
                  placeholder="My Bar"
                  className="w-full min-h-touch px-4 py-3 bg-dark-800 border border-dark-600 rounded-xl focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-dark-400 mb-2">Location (optional)</label>
                <input
                  type="text"
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  placeholder="City or address"
                  className="w-full min-h-touch px-4 py-3 bg-dark-800 border border-dark-600 rounded-xl focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent"
                />
              </div>
            </>
          ) : (
            <div>
              <label className="block text-sm font-medium text-dark-400 mb-2">Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                placeholder="you@example.com"
                className="w-full min-h-touch px-4 py-3 bg-dark-800 border border-dark-600 rounded-xl focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent"
              />
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-dark-400 mb-2">Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="w-full min-h-touch px-4 py-3 bg-dark-800 border border-dark-600 rounded-xl focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent"
            />
          </div>

          {error && <p className="text-red-400 text-sm">{error}</p>}

          <Button type="submit" disabled={loading} className="w-full !py-4">
            {loading ? 'Please wait...' : isRegister ? 'Register' : 'Log in'}
          </Button>
        </form>

        <p className="mt-8 text-center text-dark-400 text-sm">
          {isRegister ? (
            <>
              Already have an account?{' '}
              <button
                type="button"
                onClick={() => setIsRegister(false)}
                className="text-brand-400 hover:text-brand-300 font-medium"
              >
                Log in
              </button>
            </>
          ) : (
            <>
              New venue?{' '}
              <button
                type="button"
                onClick={() => setIsRegister(true)}
                className="text-brand-400 hover:text-brand-300 font-medium"
              >
                Register
              </button>
            </>
          )}
        </p>
      </div>
    </div>
  );
}
