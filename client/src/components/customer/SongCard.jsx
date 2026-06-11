export default function SongCard({ song, position }) {
  return (
    <div className="group bg-dark-800 hover:bg-dark-700/80 rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center gap-4 border border-dark-600/50 hover:border-dark-500 shadow-soft transition-all duration-300 ease-spring hover:-translate-y-0.5">
      <div className="flex items-center gap-4 flex-1 min-w-0">
        <div className="text-xl font-bold text-dark-500 w-8 shrink-0 tabular-nums text-center">
          {position}
        </div>
        <img
          src={song.albumArt}
          alt={song.title}
          loading="lazy"
          decoding="async"
          className="w-14 h-14 rounded-xl object-cover shrink-0 ring-1 ring-white/5 transition-transform duration-300 ease-spring group-hover:scale-105"
        />
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold line-clamp-2 break-words">{song.title}</h3>
          <p className="text-dark-400 text-sm line-clamp-1 break-words">{song.artist}</p>
        </div>
      </div>

      {/* Voting removed – songs now play in purchase order only */}
    </div>
  );
}
