import { useState, useEffect } from 'react';
import { ThumbsUp, ThumbsDown } from 'lucide-react';
import { formatDuration } from '../../utils/helpers';
import api from '../../utils/api';

export default function NowPlaying({ song, hasLyrics, onLyrics, venueCode, deviceId, myVote, onVote }) {
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
      await api.vote(venueCode, song.id, value, deviceId);
      onVote?.();
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
    <div className="bg-white rounded-xl p-6 mb-8 border border-carbon-200 shadow-card">
      <p className="text-xs font-bold text-amethyst-600 tracking-widest mb-3">NOW PLAYING</p>

      <div className="flex gap-4 items-center mb-4">
        <img
          src={song.albumArt}
          alt={song.title}
          className="w-20 h-20 sm:w-24 sm:h-24 rounded-xl object-cover ring-2 ring-carbon-100"
          onError={(e) => { e.currentTarget.style.display = 'none'; }}
        />
        <div className="flex-1 min-w-0">
          <h2 className="text-xl sm:text-2xl font-bold mb-1 line-clamp-2 break-words text-carbon-900">
            {song.title}
          </h2>
          <p className="text-carbon-600 text-lg line-clamp-1 break-words">{song.artist}</p>
          {song.duration && (
            <p className="text-carbon-500 text-sm mt-1">{formatDuration(song.duration)}</p>
          )}
        </div>
      </div>

      <div className="w-full bg-carbon-100 rounded-full h-2 overflow-hidden mb-4">
        <div
          className="bg-gradient-to-r from-amethyst-400 to-amethyst-900 rounded-full h-2 transition-all duration-1000"
          style={{ width: `${progress}%` }}
        />
      </div>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => handleVote(1)}
          disabled={voting}
          className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl font-semibold text-sm transition-all active:scale-95 disabled:opacity-50 ${
            myVote === 1
              ? 'bg-green-500 text-white'
              : 'bg-carbon-100 text-carbon-600 hover:bg-green-50 hover:text-green-600'
          }`}
        >
          <ThumbsUp className="h-4 w-4" />
          Like
        </button>
        <button
          type="button"
          onClick={() => handleVote(-1)}
          disabled={voting}
          className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl font-semibold text-sm transition-all active:scale-95 disabled:opacity-50 ${
            myVote === -1
              ? 'bg-red-500 text-white'
              : 'bg-carbon-100 text-carbon-600 hover:bg-red-50 hover:text-red-600'
          }`}
        >
          <ThumbsDown className="h-4 w-4" />
          Dislike
        </button>
        {hasLyrics && (
          <button
            type="button"
            onClick={onLyrics}
            className="flex-1 py-2.5 rounded-xl bg-black text-white font-semibold text-sm flex items-center justify-center gap-2 active:opacity-80 transition-opacity"
          >
            🎤 Lyrics
          </button>
        )}
      </div>
    </div>
  );
}
