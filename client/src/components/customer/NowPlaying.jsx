import { useState, useEffect } from 'react';
import { ThumbsUp, ThumbsDown } from 'lucide-react';
import { formatDuration } from '../../utils/helpers';
import api from '../../utils/api';

export default function NowPlaying({ song, hasLyrics, onLyrics, venueCode, deviceId, myVote }) {
  const [progress, setProgress] = useState(0);
  const [voting, setVoting] = useState(false);

  useEffect(() => {
    if (!song) return;
    const updateProgress = () => {
      const posMs = song.positionMs ?? 0;
      const anchoredAt = song.positionAnchoredAt ?? song.startedAt ?? null;
      const isPaused = song.isPaused ?? !!song.pausedAt;
      const elapsed = anchoredAt
        ? isPaused
          ? posMs
          : posMs + (Date.now() - anchoredAt)
        : 0;
      const duration = (song.duration || 0) * 1000;
      const percent = duration > 0 ? Math.min((elapsed / duration) * 100, 100) : 0;
      setProgress(percent);
    };

    updateProgress();
    const interval = setInterval(updateProgress, 1000);
    return () => clearInterval(interval);
  }, [song?.appleId, song?.positionMs, song?.positionAnchoredAt, song?.isPaused]);

  async function handleVote(value) {
    if (voting || !song?.id || !venueCode || !deviceId) return;
    setVoting(true);
    try {
      // The server broadcasts queue:updated over Socket.IO after a successful
      // vote — the parent component picks that up and re-renders with the new
      // myVote / vote counts. No need to trigger a fetch here (race-free, and
      // avoids the 3x-update flicker described in the H3 review finding).
      await api.vote(venueCode, song.id, value, deviceId);
    } catch (err) {
      if (err.response?.status === 429) {
        // throttled — silently ignore
      }
    } finally {
      setVoting(false);
    }
  }

  if (!song) return null;

  return (
    <div className="relative bg-gradient-to-br from-dark-800 to-dark-900 rounded-2xl p-6 mb-8 border border-dark-600/80 shadow-elevated overflow-hidden motion-safe:animate-scale-in">
      {/* Soft glow bleeding from the top, like a lit stage. Decorative. */}
      <div aria-hidden="true" className="pointer-events-none absolute -top-16 -left-10 h-40 w-40 rounded-full bg-amethyst-600/15 blur-3xl" />

      <p className="relative flex items-center gap-2 text-xs font-bold text-amethyst-300 tracking-widest mb-3">
        <span aria-hidden="true" className="inline-block w-2 h-2 rounded-full bg-amethyst-400 animate-pulse-soft" />
        NOW PLAYING
      </p>

      <div className="relative flex gap-4 items-center mb-4">
        <img
          src={song.albumArt}
          alt={song.title}
          className="w-20 h-20 sm:w-24 sm:h-24 rounded-xl object-cover ring-1 ring-white/10 shadow-soft"
          onError={(e) => { e.currentTarget.style.display = 'none'; }}
        />
        <div className="flex-1 min-w-0">
          <h2 className="text-xl sm:text-2xl font-bold mb-1 line-clamp-2 break-words text-white">
            {song.title}
          </h2>
          <p className="text-dark-300 text-lg line-clamp-1 break-words">{song.artist}</p>
          {song.duration && (
            <p className="text-dark-400 text-sm mt-1">{formatDuration(song.duration)}</p>
          )}
        </div>
      </div>

      <div
        role="progressbar"
        aria-label="Song progress"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(progress)}
        className="relative w-full bg-dark-700 rounded-full h-2 overflow-hidden mb-4"
      >
        <div
          className="bg-gradient-to-r from-amethyst-400 to-amethyst-700 rounded-full h-2 transition-all duration-1000 ease-linear"
          style={{ width: `${progress}%` }}
        />
      </div>

      {/* flex-wrap + basis-[8rem] lets the row collapse into a 2-col then 1-col
          stack at large font scales rather than squeezing the labels off-screen.
          tap-target floor (44px) keeps the hit area finger-sized regardless. */}
      <div className="flex flex-wrap items-stretch gap-3">
        <button
          type="button"
          onClick={() => handleVote(1)}
          disabled={voting}
          aria-pressed={myVote === 1}
          aria-label="Like this song"
          className={`min-h-touch grow basis-[8rem] flex items-center justify-center gap-2 py-2.5 rounded-xl font-semibold text-sm transition-all duration-300 ease-spring active:scale-95 disabled:opacity-50 ${
            myVote === 1
              ? 'bg-green-500 text-white shadow-lg shadow-green-500/25'
              : 'bg-dark-700 text-dark-200 hover:bg-green-500/15 hover:text-green-400 hover:-translate-y-0.5'
          }`}
        >
          <ThumbsUp className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span>Like</span>
        </button>
        <button
          type="button"
          onClick={() => handleVote(-1)}
          disabled={voting}
          aria-pressed={myVote === -1}
          aria-label="Dislike this song"
          className={`min-h-touch grow basis-[8rem] flex items-center justify-center gap-2 py-2.5 rounded-xl font-semibold text-sm transition-all duration-300 ease-spring active:scale-95 disabled:opacity-50 ${
            myVote === -1
              ? 'bg-red-500 text-white shadow-lg shadow-red-500/25'
              : 'bg-dark-700 text-dark-200 hover:bg-red-500/15 hover:text-red-400 hover:-translate-y-0.5'
          }`}
        >
          <ThumbsDown className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span>Dislike</span>
        </button>
        {hasLyrics && (
          <button
            type="button"
            onClick={onLyrics}
            className="min-h-touch grow basis-[8rem] py-2.5 rounded-xl bg-amethyst-500 text-white font-semibold text-sm flex items-center justify-center gap-2 transition-all duration-300 ease-spring hover:-translate-y-0.5 hover:bg-amethyst-400 active:scale-95"
          >
            <span aria-hidden="true">🎤</span>
            <span>Lyrics</span>
          </button>
        )}
      </div>
    </div>
  );
}
