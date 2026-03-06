import { useState, useEffect } from 'react';
import { ListMusic, Search, Plus, Check, X, Loader2, Sparkles, Zap } from 'lucide-react';
import api from '../../utils/api';

export default function PlaylistManager({ venueCode, variant = 'dark' }) {
  const isLight = variant === 'light';

  const [playlists, setPlaylists] = useState([]);
  const [activePlaylistId, setActivePlaylistId] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [loading, setLoading] = useState(true);

  // Create new playlist
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);

  // Search
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState(null);
  const [addedIds, setAddedIds] = useState(new Set());

  // Generate
  const [showGenerate, setShowGenerate] = useState(false);
  const [generatePrompt, setGeneratePrompt] = useState('');
  const [generateCount, setGenerateCount] = useState(100);
  const [generatingCheckout, setGeneratingCheckout] = useState(false);
  const [generateError, setGenerateError] = useState(null);

  useEffect(() => {
    setLoading(true);
    api.getVenue(venueCode)
      .then((res) => {
        const data = res.data;
        const pls = data.playlists || [];
        setPlaylists(pls);
        const activePl = data.activePlaylistId || pls[0]?.id || null;
        setActivePlaylistId(activePl);
        setSelectedId(activePl);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [venueCode]);

  function switchTab(id) {
    setSelectedId(id);
    setQuery('');
    setResults([]);
    setSearchError(null);
    setAddedIds(new Set());
    setShowGenerate(false);
    setGeneratePrompt('');
    setGenerateCount(100);
    setGenerateError(null);
  }

  const selectedPlaylist = playlists.find((p) => p.id === selectedId);

  async function handleCreate(e) {
    e.preventDefault();
    if (!newName.trim()) return;
    setCreating(true);
    try {
      const res = await api.createPlaylist(venueCode, newName.trim());
      setPlaylists(res.data.playlists);
      setActivePlaylistId(res.data.activePlaylistId);
      switchTab(res.data.playlist.id);
      setNewName('');
      setShowCreate(false);
    } catch (err) {
      alert(err.response?.data?.error || 'Could not create playlist');
    }
    setCreating(false);
  }

  async function handleDelete(playlistId) {
    if (!window.confirm('Delete this playlist and all its songs?')) return;
    try {
      const res = await api.deletePlaylist(venueCode, playlistId);
      setPlaylists(res.data.playlists);
      setActivePlaylistId(res.data.activePlaylistId);
      switchTab(res.data.playlists[0]?.id || null);
    } catch (err) {
      alert(err.response?.data?.error || 'Could not delete playlist');
    }
  }

  async function handleActivate(playlistId) {
    try {
      const res = await api.activatePlaylist(venueCode, playlistId);
      setActivePlaylistId(res.data.activePlaylistId);
    } catch (err) {
      alert(err.response?.data?.error || 'Could not set as active');
    }
  }

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
    if (!selectedId) return;
    const song = {
      id: `pl_${item.songId || item.appleId}`,
      appleId: item.songId ?? item.appleId,
      title: item.trackName ?? item.title,
      artist: item.artistName ?? item.artist,
      albumArt: item.artwork ?? item.albumArt ?? '',
      duration: item.duration ?? 0,
    };
    try {
      const res = await api.addToPlaylist(venueCode, selectedId, song);
      setPlaylists((prev) => prev.map((p) => p.id === selectedId ? { ...p, songs: res.data.playlist.songs } : p));
      setAddedIds((prev) => new Set(prev).add(song.appleId));
    } catch (err) {
      alert(err.response?.data?.error || 'Could not add song');
    }
  }

  async function handleRemove(appleId) {
    if (!selectedId) return;
    try {
      const res = await api.removeFromPlaylist(venueCode, selectedId, appleId);
      setPlaylists((prev) => prev.map((p) => p.id === selectedId ? { ...p, songs: res.data.playlist.songs } : p));
      setAddedIds((prev) => { const n = new Set(prev); n.delete(appleId); return n; });
    } catch (err) {
      alert(err.response?.data?.error || 'Could not remove song');
    }
  }

  async function handleGenerateCheckout(e) {
    e.preventDefault();
    if (!generatePrompt.trim() || !selectedId) return;
    setGeneratingCheckout(true);
    setGenerateError(null);
    try {
      const res = await api.generatePlaylistCheckout(venueCode, selectedId, generatePrompt.trim(), generateCount);
      const { redirectUrl, checkoutId } = res.data;
      localStorage.setItem(`speeldit_generate_${venueCode}`, checkoutId);
      localStorage.setItem(`speeldit_generate_prompt_${venueCode}`, generatePrompt.trim());
      localStorage.setItem(`speeldit_generate_playlist_${venueCode}`, selectedId);
      localStorage.setItem(`speeldit_generate_count_${venueCode}`, String(generateCount));
      // Open in new tab so music keeps playing in this tab; fallback to same-tab with warning if popup blocked
      const opened = window.open(redirectUrl, '_blank', 'noopener,noreferrer');
      if (!opened) {
        const proceed = window.confirm('Popup blocked. Payment in this tab will stop the music. Continue anyway?');
        if (proceed) window.location.href = redirectUrl;
      }
    } catch (err) {
      setGenerateError(err.response?.data?.error || 'Could not start payment. Try again.');
      setGeneratingCheckout(false);
    }
  }

  // ── Styles ──
  const card = isLight
    ? 'bg-white rounded-xl border border-zinc-200 shadow-sm p-5'
    : 'bg-dark-800 rounded-2xl border border-dark-600 p-5';
  const headingCls = isLight ? 'font-semibold text-zinc-900' : 'font-semibold text-white';
  const subCls = isLight ? 'text-xs text-zinc-500' : 'text-xs text-dark-400';
  const inputCls = isLight
    ? 'flex-1 px-3 py-2 bg-zinc-50 border border-zinc-300 rounded-lg text-zinc-900 placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-brand-500 text-sm'
    : 'flex-1 px-3 py-2 bg-dark-700 border border-dark-500 rounded-lg text-white placeholder-dark-400 focus:outline-none focus:ring-2 focus:ring-brand-500 text-sm';
  const songRowCls = isLight
    ? 'flex items-center gap-3 p-3 bg-zinc-50 rounded-xl group border border-zinc-100'
    : 'flex items-center gap-3 p-3 bg-dark-700/50 rounded-xl group';
  const songTitleCls = isLight ? 'font-medium text-sm text-zinc-900 line-clamp-1' : 'font-medium text-sm text-white line-clamp-1';
  const songArtistCls = isLight ? 'text-xs text-zinc-500 line-clamp-1' : 'text-xs text-dark-400 line-clamp-1';
  const removeBtnCls = isLight
    ? 'opacity-0 group-hover:opacity-100 transition-opacity w-7 h-7 flex items-center justify-center rounded-full bg-zinc-200 text-zinc-500 hover:bg-red-100 hover:text-red-500 shrink-0'
    : 'opacity-0 group-hover:opacity-100 transition-opacity w-7 h-7 flex items-center justify-center rounded-full bg-dark-600 text-dark-300 hover:bg-red-500/20 hover:text-red-400 shrink-0';
  const resultRowCls = isLight
    ? 'flex items-center gap-3 p-3 bg-zinc-50 rounded-xl border border-zinc-100'
    : 'flex items-center gap-3 p-3 bg-dark-700/50 rounded-xl';

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className={`h-6 w-6 animate-spin ${isLight ? 'text-zinc-400' : 'text-dark-400'}`} />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* ── Playlist tabs ── */}
      <div className={card}>
        <div className="flex items-center justify-between mb-3">
          <h3 className={headingCls}>Playlists</h3>
          <button
            type="button"
            onClick={() => setShowCreate((v) => !v)}
            className="flex items-center gap-1 text-xs px-3 py-1.5 rounded-lg bg-brand-500 text-white hover:bg-brand-600 transition-colors font-semibold"
          >
            <Plus className="h-3.5 w-3.5" /> New
          </button>
        </div>

        {showCreate && (
          <form onSubmit={handleCreate} className="flex gap-2 mb-3">
            <input
              autoFocus
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="e.g. Valentine's Day, New Year's Eve…"
              className={inputCls}
            />
            <button
              type="submit"
              disabled={creating || !newName.trim()}
              className="px-3 py-2 bg-brand-500 text-white rounded-lg text-sm font-semibold hover:bg-brand-600 disabled:opacity-50 shrink-0"
            >
              {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Create'}
            </button>
            <button
              type="button"
              onClick={() => { setShowCreate(false); setNewName(''); }}
              className={`px-3 py-2 rounded-lg text-sm ${isLight ? 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200' : 'bg-dark-700 text-dark-300 hover:bg-dark-600'}`}
            >
              <X className="h-4 w-4" />
            </button>
          </form>
        )}

        {playlists.length === 0 ? (
          <div className="py-6 text-center">
            <ListMusic className={`h-8 w-8 mx-auto mb-2 ${isLight ? 'text-zinc-300' : 'text-dark-500'}`} />
            <p className={subCls}>No playlists yet. Hit "New" to create your first one.</p>
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {playlists.map((pl) => (
              <button
                key={pl.id}
                type="button"
                onClick={() => switchTab(pl.id)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
                  selectedId === pl.id
                    ? 'bg-brand-500 text-white'
                    : isLight
                      ? 'bg-zinc-100 text-zinc-700 hover:bg-zinc-200'
                      : 'bg-dark-700 text-dark-300 hover:bg-dark-600'
                }`}
              >
                {pl.id === activePlaylistId && <Zap className="h-3 w-3" />}
                {pl.name}
                <span className={`text-xs ${selectedId === pl.id ? 'text-white/70' : isLight ? 'text-zinc-400' : 'text-dark-500'}`}>
                  {pl.songs?.length ?? 0}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* ── Selected playlist content ── */}
      {selectedPlaylist && (
        <>
          {/* Songs card */}
          <div className={card}>
            <div className="flex items-center justify-between mb-1">
              <div className="flex items-center gap-2 min-w-0">
                <h3 className={`${headingCls} truncate`}>{selectedPlaylist.name}</h3>
                {selectedPlaylist.id === activePlaylistId ? (
                  <span className="shrink-0 flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-semibold bg-brand-100 text-brand-700">
                    <Zap className="h-3 w-3" /> Active
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => handleActivate(selectedPlaylist.id)}
                    className={`shrink-0 text-xs px-2 py-0.5 rounded-full font-semibold border transition-colors ${isLight ? 'border-zinc-300 text-zinc-500 hover:border-brand-500 hover:text-brand-600' : 'border-dark-500 text-dark-400 hover:border-brand-500 hover:text-brand-400'}`}
                  >
                    Set Active
                  </button>
                )}
              </div>
              <button
                type="button"
                onClick={() => handleDelete(selectedPlaylist.id)}
                className={`shrink-0 text-xs px-2 py-1.5 rounded-lg transition-colors ${isLight ? 'text-zinc-400 hover:text-red-500 hover:bg-red-50' : 'text-dark-400 hover:text-red-400 hover:bg-red-500/10'}`}
              >
                Delete
              </button>
            </div>
            <p className={`${subCls} mb-4`}>
              {selectedPlaylist.songs?.length ?? 0} song{(selectedPlaylist.songs?.length ?? 0) !== 1 ? 's' : ''}
              {selectedPlaylist.id !== activePlaylistId && ' · Set as Active so autofill uses this playlist'}
            </p>

            {selectedPlaylist.songs?.length > 0 ? (
              <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                {selectedPlaylist.songs.map((song, i) => (
                  <div key={song.appleId} className={songRowCls}>
                    <span className={`text-sm font-bold w-6 text-right shrink-0 ${isLight ? 'text-zinc-400' : 'text-dark-500'}`}>{i + 1}</span>
                    {song.albumArt ? (
                      <img src={song.albumArt} alt={song.title} className="w-9 h-9 rounded-lg object-cover shrink-0" />
                    ) : (
                      <div className={`w-9 h-9 rounded-lg shrink-0 flex items-center justify-center ${isLight ? 'bg-zinc-200' : 'bg-dark-600'}`}>
                        <ListMusic className={`h-4 w-4 ${isLight ? 'text-zinc-400' : 'text-dark-400'}`} />
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <p className={songTitleCls}>{song.title}</p>
                      <p className={songArtistCls}>{song.artist}</p>
                    </div>
                    <button type="button" onClick={() => handleRemove(song.appleId)} className={removeBtnCls} title="Remove">
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="py-4 text-center">
                <p className={subCls}>No songs yet — search below or generate with AI.</p>
              </div>
            )}
          </div>

          {/* ── Generate AI Playlist ── */}
          <div className={card}>
            <div className="flex items-center justify-between mb-3">
              <h3 className={headingCls}>Generate AI Playlist</h3>
              <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${isLight ? 'bg-brand-100 text-brand-700' : 'bg-brand-500/20 text-brand-400'}`}>
                R{generateCount}
              </span>
            </div>

            {!showGenerate ? (
              <button
                type="button"
                onClick={() => setShowGenerate(true)}
                className="flex items-center gap-2 w-full justify-center px-4 py-2.5 bg-brand-500 text-white rounded-lg font-semibold text-sm hover:bg-brand-600 transition-colors"
              >
                <Sparkles className="h-4 w-4" />
                Generate songs for "{selectedPlaylist.name}"
              </button>
            ) : (
              <form onSubmit={handleGenerateCheckout} className="space-y-4">
                <p className={`text-sm ${isLight ? 'text-zinc-500' : 'text-dark-400'}`}>
                  Describe the vibe and choose how many songs. Claude picks matching tracks and adds them to <strong>{selectedPlaylist.name}</strong>.
                </p>

                {/* Song count picker */}
                <div>
                  <p className={`text-xs font-semibold mb-2 ${isLight ? 'text-zinc-600' : 'text-dark-300'}`}>How many songs?</p>
                  <div className="flex flex-wrap gap-2">
                    {[25, 50, 100, 150, 200, 300, 400].map((n) => (
                      <button
                        key={n}
                        type="button"
                        onClick={() => setGenerateCount(n)}
                        className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-colors ${
                          generateCount === n
                            ? 'bg-brand-500 text-white'
                            : isLight ? 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200' : 'bg-dark-700 text-dark-300 hover:bg-dark-600'
                        }`}
                      >
                        {n} songs · R{n}
                      </button>
                    ))}
                  </div>
                </div>

                <textarea
                  value={generatePrompt}
                  onChange={(e) => { setGeneratePrompt(e.target.value); setGenerateError(null); }}
                  placeholder='e.g. "Afrikaans hits", "2000s pop", "upbeat dancehall for Friday night"…'
                  rows={3}
                  className={`w-full px-3 py-2.5 rounded-lg text-sm resize-none focus:outline-none focus:ring-2 focus:ring-brand-500 ${isLight ? 'bg-zinc-50 border border-zinc-300 text-zinc-900 placeholder-zinc-400' : 'bg-dark-700 border border-dark-500 text-white placeholder-dark-400'}`}
                />
                {generateError && <p className="text-red-500 text-xs">{generateError}</p>}
                <div className="flex gap-2">
                  <button
                    type="submit"
                    disabled={generatingCheckout || !generatePrompt.trim()}
                    className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-brand-500 text-white rounded-lg font-semibold text-sm hover:bg-brand-600 transition-colors disabled:opacity-50"
                  >
                    {generatingCheckout ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                    {generatingCheckout ? 'Starting payment…' : `Pay R${generateCount} & Generate`}
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

          {/* ── Add Songs ── */}
          <div className={card}>
            <h3 className={`${headingCls} mb-3`}>Add Songs</h3>

            <form onSubmit={handleSearch} className="flex gap-2 mb-3">
              <input
                type="text"
                value={query}
                onChange={(e) => { setQuery(e.target.value); if (searchError) setSearchError(null); }}
                placeholder="Search for a song to add..."
                className={inputCls}
              />
              <button
                type="submit"
                disabled={searching}
                className="px-3 py-2 bg-brand-500 text-white rounded-lg font-semibold text-sm hover:bg-brand-600 transition-colors disabled:opacity-50 shrink-0 flex items-center gap-1.5"
              >
                {searching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                {!searching && 'Search'}
              </button>
            </form>

            {searchError && (
              <p className={`text-sm text-center py-2 ${isLight ? 'text-zinc-500' : 'text-dark-400'}`}>{searchError}</p>
            )}

            {results.length > 0 && (
              <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                {results.map((item) => {
                  const appleId = item.songId ?? item.appleId;
                  const inPlaylist = (selectedPlaylist.songs || []).some((s) => s.appleId === appleId) || addedIds.has(appleId);
                  return (
                    <div key={appleId} className={resultRowCls}>
                      <img src={item.artwork || item.albumArt || ''} alt={item.trackName || item.title} className="w-9 h-9 rounded-lg object-cover shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className={songTitleCls}>{item.trackName ?? item.title}</p>
                        <p className={songArtistCls}>{item.artistName ?? item.artist}</p>
                      </div>
                      <button
                        type="button"
                        disabled={inPlaylist}
                        onClick={() => handleAdd(item)}
                        className={`shrink-0 flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                          inPlaylist
                            ? isLight ? 'bg-zinc-100 text-zinc-400 cursor-default' : 'bg-dark-600 text-dark-400 cursor-default'
                            : 'bg-brand-500 text-white hover:bg-brand-600'
                        }`}
                      >
                        {inPlaylist ? <><Check className="h-3 w-3" /> Added</> : <><Plus className="h-3 w-3" /> Add</>}
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
