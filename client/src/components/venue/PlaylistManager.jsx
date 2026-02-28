import { useState, useEffect } from 'react';
import { ListMusic, Search, Plus, Check, X, Loader2 } from 'lucide-react';
import api from '../../utils/api';

export default function PlaylistManager({ venueCode }) {
  const [playlist, setPlaylist] = useState([]);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState(null);
  const [addedIds, setAddedIds] = useState(new Set());

  useEffect(() => {
    api.getVenue(venueCode)
      .then((res) => {
        setPlaylist(res.data?.playlist || []);
      })
      .catch(() => {});
  }, [venueCode]);

  async function handleSearch(e) {
    e.preventDefault();
    if (!query.trim()) return;
    setSearching(true);
    setSearchError(null);
    try {
      const res = await api.search(query.trim(), venueCode);
      const items = res.data?.results || [];
      setResults(items);
      if (items.length === 0) setSearchError('No songs found. Try a different search.');
    } catch {
      setSearchError('Search failed. Check your connection.');
      setResults([]);
    }
    setSearching(false);
  }

  async function handleAdd(item) {
    const song = {
      id: `pl_${item.songId || item.appleId}`,
      appleId: item.songId ?? item.appleId,
      title: item.trackName ?? item.title,
      artist: item.artistName ?? item.artist,
      albumArt: item.artwork ?? item.albumArt ?? '',
      duration: item.duration ?? 0,
    };
    try {
      const res = await api.addToPlaylist(venueCode, song);
      setPlaylist(res.data.playlist);
      setAddedIds((prev) => new Set(prev).add(song.appleId));
    } catch (err) {
      alert(err.response?.data?.error || 'Could not add song');
    }
  }

  async function handleRemove(appleId) {
    try {
      const res = await api.removeFromPlaylist(venueCode, appleId);
      setPlaylist(res.data.playlist);
      setAddedIds((prev) => {
        const next = new Set(prev);
        next.delete(appleId);
        return next;
      });
    } catch (err) {
      alert(err.response?.data?.error || 'Could not remove song');
    }
  }

  const playlistAppleIds = new Set(playlist.map((s) => s.appleId));

  return (
    <div className="space-y-6">
      {/* Current playlist */}
      <div className="bg-dark-800 rounded-2xl border border-dark-600 p-6">
        <div className="flex items-center gap-2 mb-4">
          <ListMusic className="h-5 w-5 text-brand-400" />
          <h3 className="text-white font-semibold">
            Playlist
            {playlist.length > 0 && (
              <span className="ml-2 text-sm text-dark-400 font-normal">
                {playlist.length} song{playlist.length !== 1 ? 's' : ''}
              </span>
            )}
          </h3>
        </div>

        {playlist.length === 0 ? (
          <div className="py-8 text-center">
            <ListMusic className="h-10 w-10 text-dark-500 mx-auto mb-3" />
            <p className="text-dark-400 text-sm">No songs in playlist yet.</p>
            <p className="text-dark-500 text-xs mt-1">Search below to add songs — autofill will play from this playlist.</p>
          </div>
        ) : (
          <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
            {playlist.map((song, i) => (
              <div
                key={song.appleId}
                className="flex items-center gap-3 p-3 bg-dark-700/50 rounded-xl group"
              >
                <span className="text-dark-500 text-sm font-bold w-6 text-right shrink-0">
                  {i + 1}
                </span>
                {song.albumArt ? (
                  <img
                    src={song.albumArt}
                    alt={song.title}
                    className="w-10 h-10 rounded-lg object-cover shrink-0"
                  />
                ) : (
                  <div className="w-10 h-10 rounded-lg bg-dark-600 shrink-0 flex items-center justify-center">
                    <ListMusic className="h-4 w-4 text-dark-400" />
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-sm text-white line-clamp-1">{song.title}</p>
                  <p className="text-xs text-dark-400 line-clamp-1">{song.artist}</p>
                </div>
                <button
                  type="button"
                  onClick={() => handleRemove(song.appleId)}
                  className="opacity-0 group-hover:opacity-100 transition-opacity w-7 h-7 flex items-center justify-center rounded-full bg-dark-600 text-dark-300 hover:bg-red-500/20 hover:text-red-400"
                  title="Remove from playlist"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Search to add songs */}
      <div className="bg-dark-800 rounded-2xl border border-dark-600 p-6">
        <h3 className="text-white font-semibold mb-4">Add Songs</h3>

        <form onSubmit={handleSearch} className="flex gap-3 mb-4">
          <input
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              if (searchError) setSearchError(null);
            }}
            placeholder="Search for a song to add..."
            className="flex-1 px-4 py-2.5 bg-dark-700 border border-dark-500 rounded-lg text-white placeholder-dark-400 focus:outline-none focus:ring-2 focus:ring-brand-500 text-sm"
          />
          <button
            type="submit"
            disabled={searching}
            className="px-4 py-2.5 bg-brand-500 text-white rounded-lg font-semibold text-sm hover:bg-brand-600 transition-colors disabled:opacity-50 shrink-0 flex items-center gap-2"
          >
            {searching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
            {searching ? 'Searching…' : 'Search'}
          </button>
        </form>

        {searchError && (
          <p className="text-dark-400 text-sm text-center py-2">{searchError}</p>
        )}

        {results.length > 0 && (
          <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
            {results.map((item) => {
              const appleId = item.songId ?? item.appleId;
              const inPlaylist = playlistAppleIds.has(appleId) || addedIds.has(appleId);
              return (
                <div
                  key={appleId}
                  className="flex items-center gap-3 p-3 bg-dark-700/50 rounded-xl"
                >
                  <img
                    src={item.artwork || item.albumArt || ''}
                    alt={item.trackName || item.title}
                    className="w-10 h-10 rounded-lg object-cover shrink-0"
                  />
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-sm text-white line-clamp-1">
                      {item.trackName ?? item.title}
                    </p>
                    <p className="text-xs text-dark-400 line-clamp-1">
                      {item.artistName ?? item.artist}
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={inPlaylist}
                    onClick={() => handleAdd(item)}
                    className={`shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                      inPlaylist
                        ? 'bg-dark-600 text-dark-400 cursor-default'
                        : 'bg-brand-500 text-white hover:bg-brand-600'
                    }`}
                  >
                    {inPlaylist ? (
                      <><Check className="h-3 w-3" /> Added</>
                    ) : (
                      <><Plus className="h-3 w-3" /> Add</>
                    )}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
