import { useState, useEffect } from 'react';
import { formatDuration } from '../../utils/helpers';

export default function NowPlaying({ song }) {
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const updateProgress = () => {
      const elapsed = Date.now() - (song.startedAt || 0);
      const duration = (song.duration || 0) * 1000;
      const percent = duration > 0 ? Math.min((elapsed / duration) * 100, 100) : 0;
      setProgress(percent);
    };

    updateProgress();
    const interval = setInterval(updateProgress, 1000);
    return () => clearInterval(interval);
  }, [song]);

  return (
    <div className="bg-white rounded-xl p-6 mb-8 border border-carbon-200 shadow-card">
      <p className="text-xs font-bold text-amethyst-600 tracking-widest mb-3">NOW PLAYING</p>

      <div className="flex gap-4 items-center mb-4">
        <img
          src={song.albumArt}
          alt={song.title}
          className="w-20 h-20 sm:w-24 sm:h-24 rounded-xl object-cover ring-2 ring-carbon-100"
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

      <div className="w-full bg-carbon-100 rounded-full h-2 overflow-hidden">
        <div
          className="bg-gradient-to-r from-amethyst-400 to-amethyst-900 rounded-full h-2 transition-all duration-1000"
          style={{ width: `${progress}%` }}
        />
      </div>
    </div>
  );
}
