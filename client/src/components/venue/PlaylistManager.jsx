import { useState, useEffect } from 'react';
import { ListMusic, Search, Plus, Check, X, Loader2, Sparkles } from 'lucide-react';
import api from '../../utils/api';

export default function PlaylistManager({ venueCode, variant = 'dark' }) {
  const isLight = variant === 'light';

  const [playlist, setPlaylist] = useState([]);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState(null);
  const [addedIds, setAddedIds] = useState(new Set());
  const [showGenerate, setShowGenerate] = useState(false);
  const [generatePrompt, setGeneratePrompt] = useState('');
  const [generatingCheckout, setGeneratingCheckout] = useState(false);
  const [generateError, setGenerateError] = useState(null);

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

  async function handleGenerateCheckout(e) {
    e.preventDefault();
    if (!generatePrompt.trim()) return;
    setGeneratingCheckout(true);
    setGenerateError(null);
    try {
      const res = await api.generatePlaylistCheckout(venueCode, generatePrompt.trim());
      const { redirectUrl, checkoutId } = res.data;
      localStorage.setItem(`votebeats_generate_${venueCode}`, checkoutId);
      window.location.href = redirectUrl;
    } catch (err) {
      setGenerateError(err.response?.data?.error || 'Could not start payment. Try again.');
      setGeneratingCheckout(false);
    }
  }

  const playlistAppleIds = new Set(playlist.map((s) => s.appleId));

  const cardClass = isLight
    ? 'bg-white rounded-xl border border-zinc-200 shadow-sm p-6'
    : 'bg-dark-800 rounded-2xl border border-dark-600 p-6';
  const headingClass = isLight ? 'text-zinc-900 font-semibold' : 'text-white font-semibold';
  const countClass = isLight ? 'ml-2 text-sm text-zinc-500 font-normal' : 'ml-2 text-sm text-dark-400 font-normal';
  const iconClass = isLight ? 'h-5 w-5 text-brand-600' : 'h-5 w-5 text-brand-400';
  const emptyIconClass = isLight ? 'h-10 w-10 text-zinc-300 mx-auto mb-3' : 'h-10 w-10 text-dark-500 mx-auto mb-3';
  const emptyTextClass = isLight ? 'text-zinc-500 text-sm' : 'text-dark-400 text-sm';
  const emptySubtextClass = isLight ? 'text-zinc-400 text-xs mt-1' : 'text-dark-500 text-xs mt-1';
  const rowClass = isLight
    ? 'flex items-center gap-3 p-3 bg-zinc-50 rounded-xl group border border-zinc-100'
    : 'flex items-center gap-3 p-3 bg-dark-700/50 rounded-xl group';
  const indexClass = isLight ? 'text-zinc-400 text-sm font-bold w-6 text-right shrink-0' : 'text-dark-500 text-sm font-bold w-6 text-right shrink-0';
  const artFallbackClass = isLight ? 'w-10 h-10 rounded-lg bg-zinc-200 shrink-0 flex items-center justify-center' : 'w-10 h-10 rounded-lg bg-dark-600 shrink-0 flex items-center justify-center';
  const artFallbackIconClass = isLight ? 'h-4 w-4 text-zinc-400' : 'h-4 w-4 text-dark-400';
  const songTitleClass = isLight ? 'font-semibold text-sm text-zinc-900 line-clamp-1' : 'font-semibold text-sm text-white line-clamp-1';
  const songArtistClass = isLight ? 'text-xs text-zinc-500 line-clamp-1' : 'text-xs text-dark-400 line-clamp-1';
  const removeClass = isLight
    ? 'opacity-0 group-hover:opacity-100 transition-opacity w-7 h-7 flex items-center justify-center rounded-full bg-zinc-200 text-zinc-500 hover:bg-red-100 hover:text-red-500'
    : 'opacity-0 group-hover:opacity-100 transition-opacity w-7 h-7 flex items-center justify-center rounded-full bg-dark-600 text-dark-300 hover:bg-red-500/20 hover:text-red-400';
  const inputClass = isLight
    ? 'flex-1 px-4 py-2.5 bg-zinc-50 border border-zinc-300 rounded-lg text-zinc-900 placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-brand-500 text-sm'
    : 'flex-1 px-4 py-2.5 bg-dark-700 border border-dark-500 rounded-lg text-white placeholder-dark-400 focus:outline-none focus:ring-2 focus:ring-brand-500 text-sm';
  const searchErrorClass = isLight ? 'text-zinc-500 text-sm text-center py-2' : 'text-dark-400 text-sm text-center py-2';
  const resultRowClass = isLight
    ? 'flex items-center gap-3 p-3 bg-zinc-50 rounded-xl border border-zinc-100'
    : 'flex items-center gap-3 p-3 bg-dark-700/50 rounded-xl';
  const resultTitleClass = isLight ? 'font-semibold text-sm text-zinc-900 line-clamp-1' : 'font-semibold text-sm text-white line-clamp-1';
  const resultArtistClass = isLight ? 'text-xs text-zinc-500 line-clamp-1' : 'text-xs text-dark-400 line-clamp-1';

  return (
    <div className="space-y-6">
      {/* Current playlist */}
      <div className={cardClass}>
        <div className="flex items-center gap-2 mb-4">
          <ListMusic className={iconClass} />
          <h3 className={headingClass}>
            Playlist
            {playlist.length > 0 && (
              <span className={countClass}>
                {playlist.length} song{playlist.length !== 1 ? 's' : ''}
              </span>
            )}
          </h3>
        </div>

        {playlist.length === 0 ? (
          <div className="py-8 text-center">
            <ListMusic className={emptyIconClass} />
            <p className={emptyTextClass}>No songs in playlist yet.</p>
            <p className={emptySubtextClass}>Search below to add songs — autofill will play from this playlist.</p>
          </div>
        ) : (
          <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
            {playlist.map((song, i) => (
              <div key={song.appleId} className={rowClass}>
                <span className={indexClass}>{i + 1}</span>
                {song.albumArt ? (
                  <img
                    src={song.albumArt}
                    alt={song.title}
                    className="w-10 h-10 rounded-lg object-cover shrink-0"
                  />
                ) : (
                  <div className={artFallbackClass}>
                    <ListMusic className={artFallbackIconClass} />
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <p className={songTitleClass}>{song.title}</p>
                  <p className={songArtistClass}>{song.artist}</p>
                </div>
                <button
                  type="button"
                  onClick={() => handleRemove(song.appleId)}
                  className={removeClass}
                  title="Remove from playlist"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Generate AI Playlist */}
      <div className={cardClass}>
        <div className="flex items-center justify-between mb-4">
          <h3 className={headingClass}>Generate AI Playlist</h3>
          <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${isLight ? 'bg-brand-100 text-brand-700' : 'bg-brand-500/20 text-brand-400'}`}>
            R50
          </span>
        </div>

        {!showGenerate ? (
          <button
            type="button"
            onClick={() => setShowGenerate(true)}
            className="flex items-center gap-2 w-full justify-center px-4 py-2.5 bg-brand-500 text-white rounded-lg font-semibold text-sm hover:bg-brand-600 transition-colors"
          >
            <Sparkles className="h-4 w-4" />
            Generate playlist with AI
          </button>
        ) : (
          <form onSubmit={handleGenerateCheckout} className="space-y-3">
            <p className={`text-sm ${isLight ? 'text-zinc-500' : 'text-dark-400'}`}>
              Describe the vibe — e.g. "Afrikaans hits", "2000s pop", "upbeat dancehall for a Friday night".
              Claude will pick 25 songs and add them to your playlist.
            </p>
            <textarea
              value={generatePrompt}
              onChange={(e) => { setGeneratePrompt(e.target.value); setGenerateError(null); }}
              placeholder="Describe your playlist vibe..."
              rows={3}
              className={`w-full px-4 py-2.5 rounded-lg text-sm resize-none focus:outline-none focus:ring-2 focus:ring-brand-500 ${isLight ? 'bg-zinc-50 border border-zinc-300 text-zinc-900 placeholder-zinc-400' : 'bg-dark-700 border border-dark-500 text-white placeholder-dark-400'}`}
            />
            {generateError && <p className="text-red-500 text-xs">{generateError}</p>}
            <div className="flex gap-2">
              <button
                type="submit"
                disabled={generatingCheckout || !generatePrompt.trim()}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-brand-500 text-white rounded-lg font-semibold text-sm hover:bg-brand-600 transition-colors disabled:opacity-50"
              >
                {generatingCheckout ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                {generatingCheckout ? 'Starting payment…' : 'Pay R50 & Generate'}
              </button>
              <button
                type="button"
                onClick={() => { setShowGenerate(false); setGeneratePrompt(''); setGenerateError(null); }}
                className={`px-3 py-2.5 rounded-lg text-sm font-medium ${isLight ? 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200' : 'bg-dark-700 text-dark-300 hover:bg-dark-600'}`}
              >
                Cancel
              </button>
            </div>
          </form>
        )}
      </div>

      {/* Search to add songs */}
      <div className={cardClass}>
        <h3 className={`${headingClass} mb-4`}>Add Songs</h3>

        <form onSubmit={handleSearch} className="flex gap-3 mb-4">
          <input
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              if (searchError) setSearchError(null);
            }}
            placeholder="Search for a song to add..."
            className={inputClass}
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
          <p className={searchErrorClass}>{searchError}</p>
        )}

        {results.length > 0 && (
          <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
            {results.map((item) => {
              const appleId = item.songId ?? item.appleId;
              const inPlaylist = playlistAppleIds.has(appleId) || addedIds.has(appleId);
              return (
                <div key={appleId} className={resultRowClass}>
                  <img
                    src={item.artwork || item.albumArt || ''}
                    alt={item.trackName || item.title}
                    className="w-10 h-10 rounded-lg object-cover shrink-0"
                  />
                  <div className="flex-1 min-w-0">
                    <p className={resultTitleClass}>{item.trackName ?? item.title}</p>
                    <p className={resultArtistClass}>{item.artistName ?? item.artist}</p>
                  </div>
                  <button
                    type="button"
                    disabled={inPlaylist}
                    onClick={() => handleAdd(item)}
                    className={`shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                      inPlaylist
                        ? isLight ? 'bg-zinc-100 text-zinc-400 cursor-default' : 'bg-dark-600 text-dark-400 cursor-default'
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
