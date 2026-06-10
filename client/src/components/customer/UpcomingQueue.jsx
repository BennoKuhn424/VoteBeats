import SongCard from './SongCard';

export default function UpcomingQueue({ songs }) {
  const orderedSongs = songs || [];

  return (
    <div className="mt-8">
      <h2 className="text-xl font-bold mb-4">Up Next</h2>

      {orderedSongs.length === 0 ? (
        <p className="text-dark-400 text-center py-12 rounded-2xl bg-dark-800/50 border border-dark-700 border-dashed motion-safe:animate-fade-in">
          No songs in queue. Search and request one!
        </p>
      ) : (
        <div className="space-y-3">
          {orderedSongs.map((song, index) => (
            <div
              key={song.id}
              className="motion-safe:animate-fade-up"
              // Cap the stagger at ~6 items so a long queue doesn't leave the
              // last cards visibly lagging in.
              style={{ animationDelay: `${Math.min(index, 6) * 60}ms` }}
            >
              <SongCard song={song} position={index + 1} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
