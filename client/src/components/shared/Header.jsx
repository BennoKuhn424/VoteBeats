import { Link } from 'react-router-dom';

export default function Header({ title, showHome = true }) {
  return (
    <header className="border-b border-dark-700 bg-dark-900/95 backdrop-blur-xl sticky top-0 z-10">
      <div className="container mx-auto pl-2 pr-4 py-4 flex items-center justify-between max-w-lg">
        <Link to="/" className="flex items-center gap-2.5 text-xl font-extrabold text-white hover:text-brand-400 transition-colors tracking-tight">
          <img src="/speeldit-logo.png" alt="Speeldit" className="h-8 w-8 rounded-lg object-contain" />
          Speeldit
        </Link>
        {showHome && (
          <Link
            to="/"
            className="text-dark-400 hover:text-white transition-colors text-sm font-medium"
          >
            Home
          </Link>
        )}
      </div>
    </header>
  );
}
