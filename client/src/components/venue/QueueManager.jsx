import Button from '../shared/Button';

export default function QueueManager({ queue, onSkip, onRemove }) {
  const { nowPlaying, upcoming } = queue || {};
  const orderedUpcoming = upcoming || [];

  return (
    <div className="bg-dark-800 rounded-2xl border border-dark-600 p-6">
      <h2 className="text-lg font-bold mb-4">Queue</h2>

      {nowPlaying && (
        <div className="mb-6 p-4 bg-brand-500/20 rounded-xl border border-brand-500/30">
          <p className="text-xs text-brand-300 font-semibold mb-2">NOW PLAYING</p>
          <div className="flex items-center gap-3">
            <img
              src={nowPlaying.albumArt}
              alt={nowPlaying.title}
              className="w-14 h-14 rounded-xl object-cover shrink-0"
            />
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-white line-clamp-2 break-words">{nowPlaying.title}</p>
              <p className="text-sm text-dark-300 line-clamp-1 break-words">{nowPlaying.artist}</p>
            </div>
            <Button variant="danger" onClick={onSkip} className="!py-2 shrink-0">
              Skip
            </Button>
          </div>
        </div>
      )}

      {!nowPlaying && (
        <p className="text-dark-400 text-sm mb-4">No song playing. Add requests below.</p>
      )}

      <h3 className="font-semibold text-dark-300 mb-2">Upcoming</h3>
      {orderedUpcoming.length === 0 ? (
        <p className="text-dark-500 text-sm">No songs in queue.</p>
      ) : (
        <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
          {orderedUpcoming.map((song, i) => (
            <div
              key={song.id}
              className="p-3 bg-dark-700/50 rounded-xl"
            >
              <div className="flex items-center gap-3 mb-2">
                <span className="text-dark-400 font-bold w-5 text-sm text-right shrink-0">
                  {i + 1}
                </span>
                <img
                  src={song.albumArt}
                  alt={song.title || 'Song'}
                  className="w-10 h-10 rounded-lg object-cover shrink-0"
                />
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-sm text-white">
                    {song.title || 'Unknown'}
                  </p>
                  <p className="text-xs text-dark-300">
                    {song.artist || 'Unknown artist'}
                  </p>
                </div>
              </div>

              <div className="flex items-center justify-end gap-3">
                <Button
                  variant="secondary"
                  className="!py-2 !px-3 text-xs shrink-0"
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
