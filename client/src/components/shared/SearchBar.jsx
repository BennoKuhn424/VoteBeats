import { useState, useEffect, useRef } from 'react';
import { Search } from 'lucide-react';
import api from '../../utils/api';

export default function SearchBar({ venueCode, onRequestSong, requestSettings }) {
  const requiresPayment = requestSettings?.requirePaymentForRequest ?? false;
  const priceRand = (requestSettings?.requestPriceCents ?? 1000) / 100;
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [searchError, setSearchError] = useState(null);
  const debounceRef = useRef(null);

  async function runSearch(searchQuery) {
    if (!searchQuery.trim()) {
      setResults([]);
      setSearchError(null);
      return;
    }

    setLoading(true);
    setSearchError(null);
    try {
      let data = [];
      try {
        const response = await api.search(searchQuery, venueCode);
        data = response.data?.results || [];
      } catch {
        const fallback = await api.searchSongs(searchQuery, venueCode);
        data = Array.isArray(fallback.data) ? fallback.data : [];
      }
      setResults(data);
      if (data.length === 0) setSearchError('No songs found. Try a different search.');
    } catch (error) {
      console.error('Search error:', error);
      setResults([]);
      setSearchError('Search failed. Check your connection.');
    }
    setLoading(false);
  }

  // Debounce: wait 300ms after user stops typing before firing API call
  useEffect(() => {
    clearTimeout(debounceRef.current);
    if (!query.trim()) {
      setResults([]);
      setSearchError(null);
      setLoading(false);
      return;
    }
    debounceRef.current = setTimeout(() => runSearch(query), 300);
    return () => clearTimeout(debounceRef.current);
  }, [query]);

  async function handleSearch(e) {
    e.preventDefault();
    clearTimeout(debounceRef.current);
    runSearch(query);
  }

  function handleRequest(item) {
    // Support both /api/search format (trackName, artistName, artwork, songId) and legacy (title, artist, albumArt, appleId)
    const song = {
      id: `song_${item.songId || item.appleId}`,
      appleId: item.songId ?? item.appleId,
      title: item.trackName ?? item.title,
      artist: item.artistName ?? item.artist,
      albumArt: item.artwork ?? item.albumArt,
      duration: item.duration ?? 0,
    };
    onRequestSong(song, requiresPayment ? { requiresPayment, priceRand } : null);
    setResults([]);
    setQuery('');
  }

  return (
    <div className="mb-8">
      <form onSubmit={handleSearch} className="flex gap-3">
        <div className="relative flex-1 min-w-0">
          <Search
            className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-dark-400"
            aria-hidden="true"
          />
          <input
            type="text"
            inputMode="search"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              if (searchError) setSearchError(null);
            }}
            placeholder="Search for a song..."
            className="w-full min-h-touch pl-11 pr-4 py-3 bg-dark-800 border border-dark-600 rounded-xl text-white placeholder-dark-400 focus:outline-none focus:ring-2 focus:ring-amethyst-400 focus:border-transparent focus:shadow-glow-amethyst shadow-soft transition-shadow duration-300 ease-spring"
          />
        </div>
        <button
          type="submit"
          disabled={loading}
          className="min-h-touch px-5 py-3 bg-gradient-to-r from-amethyst-500 to-amethyst-700 text-white rounded-xl font-semibold transition-all duration-300 ease-spring hover:-translate-y-0.5 hover:shadow-glow-amethyst active:translate-y-0 active:scale-[0.97] disabled:opacity-50 disabled:hover:translate-y-0 shrink-0 shadow-soft"
        >
          {loading ? '...' : 'Search'}
        </button>
      </form>

      {searchError && results.length === 0 && (
        <p className="mt-4 text-center text-dark-400 text-sm">{searchError}</p>
      )}
      {results.length > 0 && (
        <div className="mt-4 bg-dark-800 rounded-2xl overflow-hidden border border-dark-600 shadow-elevated max-h-72 overflow-y-auto motion-safe:animate-scale-in">
          {results.map((item, index) => (
            <button
              key={item.songId || item.appleId}
              type="button"
              className="group w-full flex items-center gap-4 p-4 hover:bg-dark-700 active:bg-dark-600 transition-colors text-left border-b border-dark-700 last:border-b-0 motion-safe:animate-fade-up"
              style={{ animationDelay: `${Math.min(index, 6) * 45}ms` }}
              onClick={() => handleRequest(item)}
            >
              <img
                src={item.artwork || item.albumArt}
                alt={item.trackName || item.title}
                loading="lazy"
                decoding="async"
                className="w-14 h-14 rounded-lg object-cover shrink-0 ring-1 ring-white/5 transition-transform duration-300 ease-spring group-hover:scale-105"
              />
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-white line-clamp-2 break-words">
                  {item.trackName ?? item.title}
                </p>
                <p className="text-sm text-dark-300 line-clamp-1 break-words">
                  {item.artistName ?? item.artist}
                </p>
              </div>
              <span className="min-h-touch px-4 flex items-center justify-center bg-gradient-to-r from-amethyst-500 to-amethyst-700 text-white rounded-xl text-sm font-bold shrink-0 transition-transform duration-300 ease-spring group-hover:scale-105 group-active:scale-95">
                {requiresPayment ? `R${priceRand}` : 'Request'}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
