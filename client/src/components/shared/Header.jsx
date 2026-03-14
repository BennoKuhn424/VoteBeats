import { Link } from 'react-router-dom';

export default function Header({ title, showHome = true }) {
  return (
    <header className="border-b border-dark-700 bg-dark-900/95 backdrop-blur-xl sticky top-0 z-10">
      <div className="container mx-auto pl-2 pr-4 py-4 flex items-center justify-end max-w-lg">
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
