import { useState } from 'react';
import { Volume2, VolumeX, ChevronDown } from 'lucide-react';
import api from '../../utils/api';

/**
 * Lets customers tell the venue the music is too loud or too soft.
 * Correlates with the volume % reported by the venue player (analytics).
 */
export default function VolumeSuggestion({ venueCode, deviceId, reportedPlayerVolume }) {
  const [status, setStatus] = useState('idle'); // idle | sending | thanks | error
  const [errMsg, setErrMsg] = useState('');
  const [open, setOpen] = useState(true);

  async function send(direction) {
    if (!venueCode || !deviceId) return;
    setStatus('sending');
    setErrMsg('');
    try {
      await api.submitVolumeFeedback(venueCode, direction, deviceId);
      setStatus('thanks');
    } catch (err) {
      const msg = err.response?.data?.error || 'Could not send. Try again later.';
      setErrMsg(msg);
      setStatus('error');
    }
  }

  return (
    <section className="mt-6 rounded-2xl border border-dark-700 bg-dark-900/80 overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left hover:bg-dark-800/50 transition-colors"
      >
        <div className="flex items-center gap-2 min-w-0">
          <div className="p-2 rounded-xl bg-brand-500/15 text-brand-400 shrink-0">
            <Volume2 className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <h2 className="text-sm font-bold text-white tracking-tight">Suggest volume</h2>
            <p className="text-xs text-dark-400 truncate">Tell the venue if it&apos;s too loud or too quiet</p>
          </div>
        </div>
        <ChevronDown
          className={`h-5 w-5 text-dark-500 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && (
        <div className="px-4 pb-4 pt-0 border-t border-dark-700/80">
          {status === 'thanks' ? (
            <p className="text-sm text-emerald-400 pt-3">Thanks — the venue will see your suggestion.</p>
          ) : (
            <>
              <p className="text-xs text-dark-400 mt-3 mb-3">
                Your feedback is anonymous and helps the venue tune the room. It&apos;s saved with the current
                playback level so they can spot patterns (e.g. many &quot;too loud&quot; when the slider is high).
              </p>
              {reportedPlayerVolume && !reportedPlayerVolume.stale && (
                <p className="text-[11px] text-dark-500 mb-3">
                  Tip: the player is set to about <span className="text-dark-300 font-medium">{reportedPlayerVolume.percent}%</span> — that context is included for the venue.
                </p>
              )}
              {status === 'error' && errMsg && (
                <p className="text-xs text-amber-400 mb-2">{errMsg}</p>
              )}
              <div className="flex flex-col sm:flex-row gap-2">
                <button
                  type="button"
                  disabled={status === 'sending'}
                  onClick={() => send('too_loud')}
                  className="flex-1 flex items-center justify-center gap-2 min-h-[44px] rounded-xl bg-dark-800 border border-dark-600 text-white text-sm font-semibold hover:bg-dark-700 hover:border-amber-500/40 disabled:opacity-50"
                >
                  <VolumeX className="h-4 w-4 text-amber-400" />
                  Too loud
                </button>
                <button
                  type="button"
                  disabled={status === 'sending'}
                  onClick={() => send('too_soft')}
                  className="flex-1 flex items-center justify-center gap-2 min-h-[44px] rounded-xl bg-dark-800 border border-dark-600 text-white text-sm font-semibold hover:bg-dark-700 hover:border-sky-500/40 disabled:opacity-50"
                >
                  <Volume2 className="h-4 w-4 text-sky-400" />
                  Too quiet
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </section>
  );
}
