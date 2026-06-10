import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';

const STORAGE_KEY = 'speeldit_cookie_consent';

export default function CookieConsent() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!localStorage.getItem(STORAGE_KEY)) {
      setVisible(true);
    }
  }, []);

  function handleAccept() {
    localStorage.setItem(STORAGE_KEY, '1');
    setVisible(false);
  }

  if (!visible) return null;

  return (
    <div className="fixed bottom-0 inset-x-0 z-[200] p-4 motion-safe:animate-fade-up">
      <div className="max-w-xl mx-auto bg-zinc-900/90 supports-[backdrop-filter]:bg-zinc-900/75 backdrop-blur-xl text-zinc-200 rounded-2xl shadow-elevated border border-zinc-700/80 px-5 py-4 flex flex-col sm:flex-row items-start sm:items-center gap-3">
        <p className="text-sm flex-1">
          We use essential cookies for authentication and session management. No tracking or advertising cookies.{' '}
          <Link to="/privacy" className="text-brand-400 hover:text-brand-300 underline">Privacy Policy</Link>
        </p>
        <button
          onClick={handleAccept}
          className="shrink-0 min-h-touch px-5 py-2 bg-brand-500 hover:bg-brand-400 text-white text-sm font-semibold rounded-xl shadow-glow-brand hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.97] transition-all duration-300 ease-spring"
        >
          Got it
        </button>
      </div>
    </div>
  );
}
