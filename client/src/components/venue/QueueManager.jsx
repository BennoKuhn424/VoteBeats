import { Ban } from 'lucide-react';
import Button from '../shared/Button';

export default function QueueManager({ queue, onRemove, onBan, variant = 'dark' }) {
  const { nowPlaying, upcoming } = queue || {};
  const orderedUpcoming = upcoming || [];
  const isLight = variant === 'light';

  const cardClass = isLight
    ? 'bg-zinc-50 dark:bg-dark-700/50 border border-zinc-200 dark:border-dark-600 rounded-lg'
    : 'bg-dark-700/50 rounded-xl';
  const nowPlayingCardClass = isLight
    ? 'mb-6 p-4 bg-brand-50 dark:bg-brand-500/20 rounded-xl border border-brand-200 dark:border-brand-500/30'
    : 'mb-6 p-4 bg-brand-500/20 rounded-xl border border-brand-500/30';
  const titleClass = isLight
    ? 'text-xs text-brand-700 dark:text-brand-300 font-semibold mb-2'
    : 'text-xs text-brand-300 font-semibold mb-2';
  const songTitleClass = isLight
    ? 'font-semibold text-zinc-900 dark:text-zinc-100 line-clamp-2 break-words'
    : 'font-semibold text-white line-clamp-2 break-words';
  const artistClass = isLight
    ? 'text-sm text-zinc-600 dark:text-zinc-300 line-clamp-1 break-words'
    : 'text-sm text-dark-300 line-clamp-1 break-words';
  const emptyClass = isLight ? 'text-zinc-500 dark:text-zinc-400 text-sm' : 'text-dark-400 text-sm';
  const upcomingLabelClass = isLight
    ? 'font-semibold text-zinc-600 dark:text-zinc-300 mb-2'
    : 'font-semibold text-dark-300 mb-2';
  const upcomingItemClass = isLight
    ? 'p-3 bg-zinc-100 dark:bg-dark-700/50 rounded-xl'
    : 'p-3 bg-dark-700/50 rounded-xl';
  const upcomingSongClass = isLight
    ? 'font-semibold text-sm text-zinc-900 dark:text-zinc-100'
    : 'font-semibold text-sm text-white';
  const upcomingArtistClass = isLight ? 'text-xs text-zinc-500 dark:text-zinc-400' : 'text-xs text-dark-300';
  const indexClass = isLight ? 'text-zinc-500 dark:text-zinc-400 text-sm' : 'text-dark-400 text-sm';

  return (
    <div className={isLight ? '' : 'bg-dark-800 rounded-2xl border border-dark-600 p-6'}>
      {nowPlaying && (
        <div className={nowPlayingCardClass}>
          <p className={titleClass}>NOW PLAYING</p>
          <div className="flex items-center gap-3">
            {nowPlaying.albumArt ? (
              <img
                src={nowPlaying.albumArt}
                alt={nowPlaying.title}
                className="w-14 h-14 rounded-xl object-cover shrink-0"
                onError={(e) => { e.currentTarget.style.display = 'none'; }}
              />
            ) : (
              <div className="w-14 h-14 rounded-xl bg-zinc-200 dark:bg-dark-700 shrink-0" />
            )}
            <div className="flex-1 min-w-0">
              <p className={songTitleClass}>{nowPlaying.title}</p>
              <p className={artistClass}>{nowPlaying.artist}</p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {onBan && nowPlaying.artist && (
                <button
                  type="button"
                  onClick={() => onBan(nowPlaying.artist)}
                  title={`Ban ${nowPlaying.artist}`}
                  className={`p-2.5 rounded-lg transition-colors ${
                    isLight
                      ? 'text-zinc-400 dark:text-zinc-500 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30'
                      : 'text-dark-400 hover:text-red-400 hover:bg-dark-600'
                  }`}
                >
                  <Ban className="h-4 w-4" />
                </button>
              )}
              <Button
                variant="danger"
                onClick={() => onRemove(nowPlaying.id)}
                className="!py-2.5 !px-4"
              >
                Remove
              </Button>
            </div>
          </div>
        </div>
      )}

      {!nowPlaying && (
        <div className={`px-4 py-3 ${cardClass} mb-4`}>
          <p className={emptyClass}>No song playing. Add requests below.</p>
        </div>
      )}

      <h3 className={`${upcomingLabelClass} mt-4`}>Upcoming</h3>
      {orderedUpcoming.length === 0 ? (
        <div className={`px-4 py-3 ${cardClass}`}>
          <p className={emptyClass}>No songs in queue.</p>
        </div>
      ) : (
        <div className="space-y-2 max-h-[45vh] overflow-y-auto pr-1">
          {orderedUpcoming.map((song, i) => (
            <div key={song.id} className={upcomingItemClass}>
              <div className="flex items-center gap-3 mb-2">
                <span className={`${indexClass} font-bold w-5 text-right shrink-0`}>
                  {i + 1}
                </span>
                {song.albumArt ? (
                  <img
                    src={song.albumArt}
                    alt={song.title || 'Song'}
                    className="w-10 h-10 rounded-lg object-cover shrink-0"
                    onError={(e) => { e.currentTarget.style.display = 'none'; }}
                  />
                ) : (
                  <div className="w-10 h-10 rounded-lg bg-zinc-200 dark:bg-dark-700 shrink-0" />
                )}
                <div className="flex-1 min-w-0">
                  <p className={upcomingSongClass}>{song.title || 'Unknown'}</p>
                  <p className={upcomingArtistClass}>{song.artist || 'Unknown artist'}</p>
                </div>
              </div>
              <div className="flex justify-end gap-2">
                {onBan && song.artist && (
                  <button
                    type="button"
                    onClick={() => onBan(song.artist)}
                    title={`Ban ${song.artist}`}
                    className={`p-2.5 rounded-lg transition-colors text-xs ${
                      isLight
                        ? 'text-zinc-400 dark:text-zinc-500 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30'
                        : 'text-dark-400 hover:text-red-400 hover:bg-dark-600'
                    }`}
                  >
                    <Ban className="h-3.5 w-3.5" />
                  </button>
                )}
                <Button
                  variant="secondary"
                  className={`!py-2.5 !px-4 text-xs shrink-0 ${isLight ? '!bg-zinc-200 dark:!bg-dark-700 !text-zinc-800 dark:!text-zinc-200 hover:!bg-zinc-300 dark:hover:!bg-dark-600 !border-zinc-300 dark:!border-dark-600' : ''}`}
                  onClick={() => onRemove(song.id)}
                >
                  Remove
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
