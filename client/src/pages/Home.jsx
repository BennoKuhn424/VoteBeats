import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import Button from '../components/shared/Button';
import Logo from '../components/shared/Logo';

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
    <div className="relative min-h-screen overflow-hidden bg-carbon-50 dark:bg-dark-950 text-carbon-800 dark:text-zinc-100 pb-safe">
      {/* Ambient brand glow — purely decorative, hidden from assistive tech.
          Two soft blurred orbs give the flat background subtle depth without
          adding any motion that could distract. */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -top-32 left-1/2 h-72 w-72 -translate-x-1/2 rounded-full bg-amethyst-500/20 blur-3xl dark:bg-amethyst-600/25" />
        <div className="absolute top-40 -right-20 h-64 w-64 rounded-full bg-brand-500/10 blur-3xl dark:bg-brand-500/15" />
      </div>

      <div className="relative container mx-auto px-5 py-16 max-w-lg">
        <div className="text-center mb-12">
          <div className="motion-safe:animate-fade-up">
            <Logo size="2xl" className="mx-auto mb-6" />
          </div>
          <p className="text-carbon-600 dark:text-zinc-300 text-lg motion-safe:animate-fade-up [animation-delay:90ms]">
            Be the vibe. Scan the QR at your table or enter the code below.
          </p>
        </div>

        <form onSubmit={handleJoin} className="space-y-4 motion-safe:animate-fade-up [animation-delay:180ms]">
          <input
            type="text"
            value={venueCode}
            onChange={(e) => setVenueCode(e.target.value.toUpperCase())}
            placeholder="ABC123"
            maxLength={8}
            aria-label="Venue code"
            className="w-full min-h-touch px-6 py-4 bg-white dark:bg-dark-800/80 border border-carbon-200 dark:border-dark-600 rounded-2xl text-carbon-900 dark:text-zinc-100 placeholder-carbon-400 dark:placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-amethyst-400 focus:border-transparent focus:shadow-glow-amethyst text-center text-2xl tracking-[0.3em] uppercase font-bold shadow-soft transition-shadow duration-300 ease-spring"
          />
          <Button type="submit" className="w-full !py-4 text-lg">
            Join &amp; vote
          </Button>
        </form>

        <p className="mt-10 text-center text-carbon-500 dark:text-zinc-400 text-sm motion-safe:animate-fade-up [animation-delay:260ms]">
          Venue owner?{' '}
          <Link
            to="/venue/login"
            className="text-amethyst-600 dark:text-amethyst-400 hover:text-amethyst-700 dark:hover:text-amethyst-300 font-medium transition-colors"
          >
            Log in to your dashboard
          </Link>
        </p>

        <footer className="mt-12 pt-6 border-t border-carbon-200 dark:border-dark-700 text-center text-xs text-carbon-400 dark:text-zinc-500 space-x-4">
          <Link to="/privacy" className="hover:text-carbon-600 dark:hover:text-zinc-200 transition-colors">Privacy Policy</Link>
          <Link to="/terms" className="hover:text-carbon-600 dark:hover:text-zinc-200 transition-colors">Terms of Service</Link>
        </footer>
      </div>
    </div>
  );
}
