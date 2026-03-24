import { useState, useEffect, useRef } from 'react';
import { ListMusic, Search, Plus, Check, X, Loader2, Sparkles, Zap, Pencil } from 'lucide-react';
import api from '../../utils/api';
import { dispatchVenuePlayerMetaRefresh } from '../../utils/venuePlayerEvents';

export default function PlaylistManager({
  venueCode,
  variant = 'dark',
  initialPlaylistId = null,
  preferEditMode = false,
}) {
  const isLight = variant === 'light';

  const [playlists, setPlaylists] = useState([]);
  const [activePlaylistId, setActivePlaylistId] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [isEditing, setIsEditing] = useState(false);
  const [loading, setLoading] = useState(true);
  const activePlaylistIdRef = useRef(null);
  useEffect(() => {
    activePlaylistIdRef.current = activePlaylistId;
  }, [activePlaylistId]);

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
        setActivePlaylistId(data.activePlaylistId || pls[0]?.id || null);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [venueCode]);

  // Pick selected playlist: deep-link from browse cards, else keep valid selection, else active.
  // (activePlaylistId omitted from deps so venue refetch does not exit edit mode.)
  useEffect(() => {
    if (playlists.length === 0) {
      setSelectedId(null);
      return;
    }
    if (initialPlaylistId && playlists.some((p) => p.id === initialPlaylistId)) {
      setSelectedId(initialPlaylistId);
      setIsEditing(!!preferEditMode);
      return;
    }
    setSelectedId((prev) => {
      if (prev != null && playlists.some((p) => p.id === prev)) return prev;
      return activePlaylistIdRef.current || playlists[0]?.id || null;
    });
  }, [playlists, initialPlaylistId, preferEditMode]);

  function switchTab(id) {
    setSelectedId(id);
    setIsEditing(false);
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
      dispatchVenuePlayerMetaRefresh();
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
      dispatchVenuePlayerMetaRefresh();
    } catch (err) {
      alert(err.response?.data?.error || 'Could not delete playlist');
    }
  }

  async function handleActivate(playlistId) {
    try {
      const res = await api.activatePlaylist(venueCode, playlistId);
      setActivePlaylistId(res.data.activePlaylistId);
      dispatchVenuePlayerMetaRefresh();
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
  const songRowEditCls = isLight
    ? 'flex items-center gap-3 px-3 py-2.5 bg-white group hover:bg-zinc-50/90'
    : 'flex items-center gap-3 px-3 py-2.5 group hover:bg-dark-700/80';
  const resultRowEditCls = isLight
    ? 'flex items-center gap-3 px-3 py-2.5 bg-white group hover:bg-zinc-50/90'
    : 'flex items-center gap-3 px-3 py-2.5 group hover:bg-dark-700/80';
  const songTitleCls = isLight ? 'font-medium text-sm text-zinc-900 line-clamp-1' : 'font-medium text-sm text-white line-clamp-1';
  const songArtistCls = isLight ? 'text-xs text-zinc-500 line-clamp-1' : 'text-xs text-dark-400 line-clamp-1';
  const removeBtnCls = isLight
    ? 'sm:opacity-0 sm:group-hover:opacity-100 transition-opacity w-8 h-8 flex items-center justify-center rounded-full bg-zinc-200 text-zinc-500 hover:bg-red-100 hover:text-red-500 shrink-0'
    : 'sm:opacity-0 sm:group-hover:opacity-100 transition-opacity w-8 h-8 flex items-center justify-center rounded-full bg-dark-600 text-dark-300 hover:bg-red-500/20 hover:text-red-400 shrink-0';

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
            className="flex items-center gap-1 text-xs px-3 py-2 rounded-lg bg-brand-500 text-white hover:bg-brand-600 transition-colors font-semibold min-h-[36px]"
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
                className={`flex items-center gap-1.5 px-3 py-2 rounded-full text-sm font-medium transition-colors ${
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

      {/* ── Selected playlist: summary vs edit ── */}
      {selectedPlaylist && (
        <>
          {/* Summary (default): no song list / add / AI until Edit */}
          {!isEditing && (
            <div className={card}>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0 flex-1">
                  <h3 className={`${headingCls} text-lg`}>{selectedPlaylist.name}</h3>
                  <p className={`${subCls} mt-1`}>
                    {(selectedPlaylist.songs?.length ?? 0) === 0
                      ? 'Empty playlist'
                      : `${selectedPlaylist.songs?.length ?? 0} song${(selectedPlaylist.songs?.length ?? 0) === 1 ? '' : 's'}`}
                    {selectedPlaylist.id !== activePlaylistId && ' · Set as active so autofill uses this playlist'}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  {selectedPlaylist.id === activePlaylistId ? (
                    <span className="inline-flex items-center gap-1 text-xs px-3 py-2 rounded-full font-semibold bg-emerald-100 text-emerald-800 min-h-[40px]">
                      <Zap className="h-3.5 w-3.5" /> Active
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => handleActivate(selectedPlaylist.id)}
                      className={`text-xs px-3 py-2 rounded-full font-semibold border transition-colors min-h-[40px] ${isLight ? 'border-zinc-300 text-zinc-600 hover:border-brand-500 hover:text-brand-600' : 'border-dark-500 text-dark-400 hover:border-brand-500 hover:text-brand-400'}`}
                    >
                      Set active
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setIsEditing(true)}
                    className="inline-flex items-center justify-center gap-1.5 text-xs px-3 py-2 rounded-full font-semibold min-h-[40px] bg-brand-500 text-white hover:bg-brand-600 transition-colors"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                    Edit playlist
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete(selectedPlaylist.id)}
                    className={`text-xs px-3 py-2 rounded-lg transition-colors min-h-[40px] ${isLight ? 'text-zinc-400 hover:text-red-600 hover:bg-red-50' : 'text-dark-400 hover:text-red-400 hover:bg-red-500/10'}`}
                  >
                    Delete
                  </button>
                </div>
              </div>
              <p className={`text-sm mt-4 pt-4 border-t ${isLight ? 'border-zinc-100 text-zinc-500' : 'border-dark-600 text-dark-400'}`}>
                Tap <strong className={isLight ? 'text-zinc-700' : 'text-white'}>Edit playlist</strong> to add or remove songs, or use AI generation.
              </p>
            </div>
          )}

          {isEditing && (
            <>
              <div className={`rounded-xl border overflow-hidden ${isLight ? 'border-zinc-200 bg-zinc-50/80' : 'border-dark-600 bg-dark-800/50'}`}>
                <div className={`flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between border-b ${isLight ? 'border-zinc-200 bg-white' : 'border-dark-600 bg-dark-800'}`}>
                  <div className="min-w-0">
                    <p className={`text-xs font-semibold uppercase tracking-wide ${isLight ? 'text-zinc-400' : 'text-dark-500'}`}>Editing playlist</p>
                    <p className={`font-semibold truncate ${isLight ? 'text-zinc-900' : 'text-white'}`}>{selectedPlaylist.name}</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => handleDelete(selectedPlaylist.id)}
                      className={`text-xs px-3 py-2 rounded-lg min-h-[40px] ${isLight ? 'text-red-600 hover:bg-red-50' : 'text-red-400 hover:bg-red-500/10'}`}
                    >
                      Delete playlist
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setIsEditing(false);
                        setShowGenerate(false);
                        setQuery('');
                        setResults([]);
                        setSearchError(null);
                        setGeneratePrompt('');
                        setGenerateError(null);
                      }}
                      className={`text-sm font-semibold px-4 py-2 rounded-lg min-h-[40px] ${isLight ? 'bg-zinc-900 text-white hover:bg-zinc-800' : 'bg-white text-zinc-900 hover:bg-zinc-100'}`}
                    >
                      Done
                    </button>
                  </div>
                </div>

                <div className="p-4 sm:p-5 space-y-5">
                  {/* Songs */}
                  <div>
                    <h4 className={`${headingCls} text-sm mb-3`}>Songs in playlist</h4>
                    {selectedPlaylist.songs?.length > 0 ? (
                      <div className={`rounded-xl border max-h-[min(50vh,420px)] overflow-y-auto ${isLight ? 'border-zinc-200 bg-white' : 'border-dark-600'}`}>
                        <ul className={`list-none m-0 p-0 divide-y ${isLight ? 'divide-zinc-100' : 'divide-dark-600'}`}>
                          {selectedPlaylist.songs.map((song, i) => (
                            <li key={song.appleId} className={songRowEditCls}>
                              <span className={`text-xs font-semibold w-7 text-right tabular-nums shrink-0 ${isLight ? 'text-zinc-400' : 'text-dark-500'}`}>{i + 1}</span>
                              {song.albumArt ? (
                                <img src={song.albumArt} alt="" className="w-10 h-10 rounded-md object-cover shrink-0" />
                              ) : (
                                <div className={`w-10 h-10 rounded-md shrink-0 flex items-center justify-center ${isLight ? 'bg-zinc-100' : 'bg-dark-600'}`}>
                                  <ListMusic className={`h-4 w-4 ${isLight ? 'text-zinc-400' : 'text-dark-400'}`} />
                                </div>
                              )}
                              <div className="flex-1 min-w-0">
                                <p className={songTitleCls}>{song.title}</p>
                                <p className={songArtistCls}>{song.artist}</p>
                              </div>
                              <button type="button" onClick={() => handleRemove(song.appleId)} className={removeBtnCls} title="Remove from playlist">
                                <X className="h-3.5 w-3.5" />
                              </button>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : (
                      <p className={`text-sm py-6 text-center rounded-xl border border-dashed ${isLight ? 'border-zinc-200 text-zinc-500 bg-white' : 'border-dark-600 text-dark-400'}`}>
                        No songs yet — search below or generate with AI.
                      </p>
                    )}
                  </div>

                  {/* Add songs */}
                  <div className={`rounded-xl border p-4 ${isLight ? 'border-zinc-200 bg-white' : 'border-dark-600'}`}>
                    <h4 className={`${headingCls} text-sm mb-3`}>Add songs</h4>
                    <form onSubmit={handleSearch} className="flex flex-col gap-2 sm:flex-row sm:gap-2 mb-3">
                      <input
                        type="text"
                        value={query}
                        onChange={(e) => { setQuery(e.target.value); if (searchError) setSearchError(null); }}
                        placeholder="Search Apple Music…"
                        className={inputCls}
                      />
                      <button
                        type="submit"
                        disabled={searching}
                        className="px-4 py-2 bg-brand-500 text-white rounded-lg font-semibold text-sm hover:bg-brand-600 transition-colors disabled:opacity-50 shrink-0 flex items-center justify-center gap-1.5 min-h-[44px]"
                      >
                        {searching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                        {!searching && 'Search'}
                      </button>
                    </form>
                    {searchError && (
                      <p className={`text-sm py-2 ${isLight ? 'text-zinc-500' : 'text-dark-400'}`}>{searchError}</p>
                    )}
                    {results.length > 0 && (
                      <div className={`rounded-lg border max-h-[min(40vh,360px)] overflow-y-auto ${isLight ? 'border-zinc-100' : 'border-dark-600'}`}>
                        <ul className={`list-none m-0 p-0 divide-y ${isLight ? 'divide-zinc-100' : 'divide-dark-600'}`}>
                          {results.map((item) => {
                            const appleId = item.songId ?? item.appleId;
                            const inPlaylist = (selectedPlaylist.songs || []).some((s) => s.appleId === appleId) || addedIds.has(appleId);
                            return (
                              <li key={appleId} className={resultRowEditCls}>
                                <img src={item.artwork || item.albumArt || ''} alt="" className="w-10 h-10 rounded-md object-cover shrink-0 bg-zinc-100" />
                                <div className="flex-1 min-w-0">
                                  <p className={songTitleCls}>{item.trackName ?? item.title}</p>
                                  <p className={songArtistCls}>{item.artistName ?? item.artist}</p>
                                </div>
                                <button
                                  type="button"
                                  disabled={inPlaylist}
                                  onClick={() => handleAdd(item)}
                                  className={`shrink-0 flex items-center gap-1 px-3 py-2 rounded-lg text-xs font-semibold transition-colors min-h-[40px] ${
                                    inPlaylist
                                      ? isLight ? 'bg-zinc-100 text-zinc-400 cursor-default' : 'bg-dark-600 text-dark-400 cursor-default'
                                      : 'bg-brand-500 text-white hover:bg-brand-600'
                                  }`}
                                >
                                  {inPlaylist ? <><Check className="h-3 w-3" /> In list</> : <><Plus className="h-3 w-3" /> Add</>}
                                </button>
                              </li>
                            );
                          })}
                        </ul>
                      </div>
                    )}
                  </div>

                  {/* AI */}
                  <div className={`rounded-xl border p-4 ${isLight ? 'border-zinc-200 bg-white' : 'border-dark-600'}`}>
                    <div className="flex items-center justify-between gap-2 mb-3">
                      <h4 className={`${headingCls} text-sm flex items-center gap-2`}>
                        <Sparkles className="h-4 w-4 text-brand-500" />
                        Add songs with AI
                      </h4>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-semibold shrink-0 ${isLight ? 'bg-brand-100 text-brand-700' : 'bg-brand-500/20 text-brand-400'}`}>
                        R{generateCount}
                      </span>
                    </div>
                    {!showGenerate ? (
                      <button
                        type="button"
                        onClick={() => setShowGenerate(true)}
                        className="flex items-center gap-2 w-full justify-center px-4 py-3 bg-gradient-to-r from-brand-500 to-orange-500 text-white rounded-lg font-semibold text-sm hover:opacity-95 transition-opacity min-h-[48px]"
                      >
                        <Sparkles className="h-4 w-4" />
                        Generate into &ldquo;{selectedPlaylist.name}&rdquo;
                      </button>
                    ) : (
                      <form onSubmit={handleGenerateCheckout} className="space-y-4">
                        <p className={`text-sm ${isLight ? 'text-zinc-500' : 'text-dark-400'}`}>
                          Describe the vibe. Matching tracks are added to <strong className={isLight ? 'text-zinc-800' : 'text-white'}>{selectedPlaylist.name}</strong> after payment.
                        </p>
                        <div>
                          <p className={`text-xs font-semibold mb-2 ${isLight ? 'text-zinc-600' : 'text-dark-300'}`}>How many songs?</p>
                          <div className="flex flex-wrap gap-2">
                            {[25, 50, 100, 150, 200, 300, 400].map((n) => (
                              <button
                                key={n}
                                type="button"
                                onClick={() => setGenerateCount(n)}
                                className={`px-3 py-2 rounded-full text-xs font-semibold transition-colors ${
                                  generateCount === n
                                    ? 'bg-brand-500 text-white'
                                    : isLight ? 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200' : 'bg-dark-700 text-dark-300 hover:bg-dark-600'
                                }`}
                              >
                                {n} · R{n}
                              </button>
                            ))}
                          </div>
                        </div>
                        <textarea
                          value={generatePrompt}
                          onChange={(e) => { setGeneratePrompt(e.target.value); setGenerateError(null); }}
                          placeholder='e.g. "Afrikaans hits", "2000s pop", "Friday night dancehall"…'
                          rows={3}
                          className={`w-full px-3 py-2.5 rounded-lg text-sm resize-none focus:outline-none focus:ring-2 focus:ring-brand-500 ${isLight ? 'bg-zinc-50 border border-zinc-300 text-zinc-900 placeholder-zinc-400' : 'bg-dark-700 border border-dark-500 text-white placeholder-dark-400'}`}
                        />
                        {generateError && <p className="text-red-500 text-xs">{generateError}</p>}
                        <div className="flex flex-col-reverse sm:flex-row gap-2">
                          <button
                            type="button"
                            onClick={() => { setShowGenerate(false); setGeneratePrompt(''); setGenerateError(null); }}
                            className={`px-4 py-2.5 rounded-lg text-sm font-medium min-h-[44px] ${isLight ? 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200' : 'bg-dark-700 text-dark-300 hover:bg-dark-600'}`}
                          >
                            Cancel
                          </button>
                          <button
                            type="submit"
                            disabled={generatingCheckout || !generatePrompt.trim()}
                            className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-brand-500 text-white rounded-lg font-semibold text-sm hover:bg-brand-600 transition-colors disabled:opacity-50 min-h-[44px]"
                          >
                            {generatingCheckout ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                            {generatingCheckout ? 'Starting payment…' : `Pay R${generateCount} & generate`}
                          </button>
                        </div>
                      </form>
                    )}
                  </div>
                </div>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
