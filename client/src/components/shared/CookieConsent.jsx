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
    <div className="fixed bottom-0 inset-x-0 z-[200] p-4">
      <div className="max-w-xl mx-auto bg-zinc-900 text-zinc-200 rounded-xl shadow-2xl border border-zinc-700 px-5 py-4 flex flex-col sm:flex-row items-start sm:items-center gap-3">
        <p className="text-sm flex-1">
          We use essential cookies for authentication and session management. No tracking or advertising cookies.{' '}
          <Link to="/privacy" className="text-brand-400 hover:text-brand-300 underline">Privacy Policy</Link>
        </p>
        <button
          onClick={handleAccept}
          className="shrink-0 px-5 py-2 bg-brand-500 hover:bg-brand-600 text-white text-sm font-semibold rounded-lg transition-colors min-h-[40px]"
        >
          Got it
        </button>
      </div>
    </div>
  );
}
