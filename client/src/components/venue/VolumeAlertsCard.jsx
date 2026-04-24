import { useEffect, useState } from 'react';
import { Volume2, X, Megaphone } from 'lucide-react';
import socket from '../../utils/socket';
import { isValidVolumeFeedbackPayload } from '../../utils/socketValidation';

/**
 * Live volume suggestions from customers (Socket.IO). Complements analytics charts.
 */
export default function VolumeAlertsCard({ venueCode, variant = 'light' }) {
  const [alerts, setAlerts] = useState([]);
  const isLight = variant === 'light';

  useEffect(() => {
    if (!venueCode) return;

    function joinRoom() {
      socket.emit('join', venueCode);
    }

    socket.connect();
    joinRoom();

    function onConnect() {
      joinRoom();
    }

    function onVolumeFeedback(payload) {
      if (!isValidVolumeFeedbackPayload(payload)) return;
      const id = `${payload.at || Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      setAlerts((prev) => [{ id, ...payload }, ...prev].slice(0, 20));
    }

    socket.on('connect', onConnect);
    socket.on('volume:feedback', onVolumeFeedback);

    return () => {
      socket.off('connect', onConnect);
      socket.off('volume:feedback', onVolumeFeedback);
    };
  }, [venueCode]);

  function dismiss(id) {
    setAlerts((prev) => prev.filter((a) => a.id !== id));
  }

  if (alerts.length === 0) return null;

  return (
    <div
      className={`mb-6 p-4 rounded-xl border shadow-sm ${
        isLight ? 'bg-amber-50/80 dark:bg-amber-950/40 border-amber-200 dark:border-amber-700/50' : 'bg-amber-950/40 border-amber-700/50'
      }`}
    >
      <div className="flex items-start gap-3">
        <div className={`p-2 rounded-lg shrink-0 ${isLight ? 'bg-amber-100 dark:bg-amber-900/50' : 'bg-amber-900/50'}`}>
          <Megaphone className={`h-5 w-5 ${isLight ? 'text-amber-700 dark:text-amber-300' : 'text-amber-300'}`} />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className={`text-sm font-semibold mb-1 ${isLight ? 'text-amber-900 dark:text-amber-100' : 'text-amber-100'}`}>
            Volume suggestions from guests
          </h3>
          <p className={`text-xs mb-2 ${isLight ? 'text-amber-800/80 dark:text-amber-200/70' : 'text-amber-200/70'}`}>
            Someone just sent feedback from the voting page. Charts by volume level are in Analytics below.
          </p>
          <ul className="space-y-2">
            {alerts.map((a) => (
              <li
                key={a.id}
                className={`flex items-center justify-between gap-2 rounded-lg px-3 py-2 text-sm ${
                  isLight ? 'bg-white/80 dark:bg-dark-900/40 border border-amber-100 dark:border-amber-800/30' : 'bg-dark-900/40 border border-amber-800/30'
                }`}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <Volume2 className={`h-4 w-4 shrink-0 ${isLight ? 'text-amber-600 dark:text-amber-400' : 'text-amber-400'}`} />
                  <span className={`font-medium truncate ${isLight ? 'text-zinc-800 dark:text-white' : 'text-white'}`}>
                    {a.direction === 'too_loud' ? 'Too loud' : 'Too quiet'}
                  </span>
                  {typeof a.volumePercent === 'number' && (
                    <span className={`text-xs shrink-0 ${isLight ? 'text-zinc-500 dark:text-zinc-400' : 'text-dark-400'}`}>
                      @ ~{a.volumePercent}%
                      {a.volumeStale ? ' (stale)' : ''}
                    </span>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => dismiss(a.id)}
                  className={`p-1.5 rounded-md shrink-0 ${isLight ? 'hover:bg-amber-100 dark:hover:bg-dark-700 text-zinc-500 dark:text-zinc-300' : 'hover:bg-dark-700 text-dark-300'}`}
                  aria-label="Dismiss"
                >
                  <X className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
