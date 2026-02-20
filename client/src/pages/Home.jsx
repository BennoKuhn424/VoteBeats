import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import Header from '../components/shared/Header';
import Button from '../components/shared/Button';

export default function Home() {
  const [venueCode, setVenueCode] = useState('');
  const navigate = useNavigate();

  function handleJoin(e) {
    e.preventDefault();
    const code = venueCode.trim().toUpperCase();
    if (!code) return;
    navigate(`/v/${code}`);
  }

  return (
    <div className="min-h-screen bg-carbon-50 text-carbon-800 pb-safe">
      <Header />
      <div className="container mx-auto px-5 py-12 max-w-lg">
        <div className="text-center mb-12">
          <h1 className="text-4xl sm:text-5xl font-extrabold mb-3 tracking-tight text-carbon-900">
            VoteBeats
          </h1>
          <p className="text-carbon-600 text-lg">
            Control the vibe. Scan the QR at your table or enter the code below.
          </p>
        </div>

        <form onSubmit={handleJoin} className="space-y-4">
          <input
            type="text"
            value={venueCode}
            onChange={(e) => setVenueCode(e.target.value.toUpperCase())}
            placeholder="ABC123"
            maxLength={8}
            className="w-full min-h-touch px-6 py-4 bg-white border border-carbon-200 rounded-xl text-carbon-900 placeholder-carbon-400 focus:outline-none focus:ring-2 focus:ring-amethyst-400 focus:border-transparent text-center text-2xl tracking-[0.3em] uppercase font-bold shadow-card"
          />
          <Button type="submit" className="w-full !py-4 text-lg">
            Join & vote
          </Button>
        </form>

        <p className="mt-10 text-center text-carbon-500 text-sm">
          Venue owner?{' '}
          <Link
            to="/venue/login"
            className="text-amethyst-600 hover:text-amethyst-700 font-medium transition-colors"
          >
            Log in to your dashboard
          </Link>
        </p>
      </div>
    </div>
  );
}
