import { useState, useEffect, useRef } from 'react';
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
          style={{ color: '#111', WebkitTextFillColor: '#111' }}
          className="flex-1 min-h-touch px-4 py-3 bg-white border border-carbon-200 rounded-lg text-carbon-900 placeholder-carbon-400 focus:outline-none focus:ring-2 focus:ring-amethyst-400 focus:border-transparent shadow-button"
        />
        <button
          type="submit"
          disabled={loading}
          className="min-h-touch px-5 py-3 bg-gradient-to-r from-amethyst-400 to-amethyst-900 text-white rounded-lg font-semibold hover:opacity-95 transition-opacity disabled:opacity-50 shrink-0 shadow-button"
        >
          {loading ? '...' : 'Search'}
        </button>
      </form>

      {searchError && results.length === 0 && (
        <p className="mt-4 text-center text-carbon-500 text-sm">{searchError}</p>
      )}
      {results.length > 0 && (
        <div className="mt-4 bg-white rounded-xl overflow-hidden border border-carbon-200 shadow-card max-h-72 overflow-y-auto">
          {results.map((item) => (
            <button
              key={item.songId || item.appleId}
              type="button"
              className="w-full flex items-center gap-4 p-4 hover:bg-carbon-50 active:bg-carbon-100 transition-colors text-left border-b border-carbon-100 last:border-b-0"
              onClick={() => handleRequest(item)}
            >
              <img
                src={item.artwork || item.albumArt}
                alt={item.trackName || item.title}
                className="w-14 h-14 rounded-lg object-cover shrink-0"
              />
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-carbon-900 line-clamp-2 break-words" style={{ color: '#202124' }}>
                  {item.trackName ?? item.title}
                </p>
                <p className="text-sm text-carbon-500 line-clamp-1 break-words" style={{ color: '#5f6368' }}>
                  {item.artistName ?? item.artist}
                </p>
              </div>
              <span className="min-h-touch px-4 flex items-center justify-center bg-gradient-to-r from-amethyst-400 to-amethyst-900 text-white rounded-lg text-sm font-bold shrink-0">
                {requiresPayment ? `R${priceRand}` : 'Request'}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
