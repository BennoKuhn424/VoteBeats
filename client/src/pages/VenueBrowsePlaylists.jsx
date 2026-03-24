import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Search, Check, ListMusic, Clock, Loader2 } from 'lucide-react';
import api from '../utils/api';
import PlaylistManager from '../components/venue/PlaylistManager';
import PlaylistScheduleModal from '../components/venue/PlaylistScheduleModal';
import { dispatchVenuePlayerMetaRefresh } from '../utils/venuePlayerEvents';

function CategoryPill({ label, isActive, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-4 py-2 rounded-full font-medium text-sm whitespace-nowrap transition-all min-h-[44px] ${
        isActive ? 'bg-brand-500 text-white shadow-md' : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200 active:scale-95'
      }`}
    >
      {label}
    </button>
  );
}

function PlaylistCard({ playlist, songCount, coverUrl, isActive, isScheduled, isLoading, onSelect, onSchedule, onOpen }) {
  return (
    <div
      className={`group relative bg-white rounded-xl border shadow-sm overflow-hidden transition-all duration-300 hover:scale-[1.01] hover:shadow-lg cursor-pointer ${
        isActive ? 'border-brand-500 ring-2 ring-brand-500 ring-offset-2' : 'border-zinc-200'
      }`}
      onClick={() => onOpen(playlist.id)}
    >
      <div className="relative aspect-square overflow-hidden bg-gradient-to-br from-zinc-200 to-zinc-400">
        {coverUrl ? (
          <img src={coverUrl} alt="" className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105" />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-zinc-500">
            <ListMusic className="w-16 h-16 opacity-40" />
          </div>
        )}
        <div className="absolute top-3 right-3 flex flex-col gap-1 items-end">
          {isActive && (
            <span className="inline-flex items-center gap-1 px-3 py-1 bg-green-600 text-white rounded-full text-xs font-medium">
              <Check className="w-3 h-3" />
              Active
            </span>
          )}
          {isScheduled && (
            <span className="inline-flex items-center gap-1 px-2 py-1 bg-brand-500 text-white rounded-full text-xs font-medium">
              <Clock className="w-3 h-3" />
              Scheduled
            </span>
          )}
        </div>
      </div>
      <div className="p-3">
        <h3 className="text-zinc-900 mb-1 line-clamp-1 text-sm font-semibold">{playlist.name}</h3>
        <p className="text-zinc-400 mb-3 text-xs">{songCount} songs</p>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onSelect(playlist.id); }}
            disabled={isActive || isLoading}
            className={`flex-1 py-2 px-3 rounded-lg font-medium transition-all min-h-[44px] text-sm ${
              isActive
                ? 'bg-green-600 text-white cursor-default'
                : 'bg-brand-500 hover:bg-brand-600 text-white active:scale-95 disabled:opacity-50'
            }`}
          >
            {isActive ? (
              <span className="flex items-center justify-center gap-1.5">
                <Check className="w-3.5 h-3.5" />
                Active
              </span>
            ) : (
              'Set active'
            )}
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onSchedule(playlist.id);
            }}
            className={`p-2 border rounded-lg hover:border-brand-500 hover:bg-orange-50 transition-all min-h-[44px] min-w-[44px] flex items-center justify-center ${
              isScheduled ? 'border-brand-500 bg-orange-50' : 'border-zinc-300'
            }`}
            aria-label="Schedule playlist"
            title="Schedule by time of day"
          >
            <Clock className="w-4 h-4 text-zinc-600" />
          </button>
        </div>
      </div>
    </div>
  );
}

export default function VenueBrowsePlaylists() {
  const navigate = useNavigate();
  const venueCode = localStorage.getItem('speeldit_venue_code');
  const [venue, setVenue] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [selectedCategory, setSelectedCategory] = useState('All');
  const [query, setQuery] = useState('');
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [schedulePlaylistId, setSchedulePlaylistId] = useState(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [generateStatus, setGenerateStatus] = useState(null);
  // When a playlist card is tapped, scroll to the PlaylistManager and select it
  const [openPlaylistId, setOpenPlaylistId] = useState(null);

  const categories = ['All', 'Has songs', 'Empty'];

  function loadVenue() {
    if (!venueCode) return;
    api
      .getVenue(venueCode)
      .then((res) => {
        setVenue(res.data);
        setLoadError(null);
      })
      .catch(() => setLoadError('Could not load venue'));
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { loadVenue(); }, [venueCode]);

  // ── Detect ?generatePlaylist=1 after Yoco redirect ────────────────────────
  useEffect(() => {
    if (!venueCode) return;
    const params = new URLSearchParams(window.location.search);
    if (params.get('generatePlaylist') !== '1') return;

    window.history.replaceState({}, '', window.location.pathname);
    const checkoutId = localStorage.getItem(`speeldit_generate_${venueCode}`);
    if (!checkoutId) return;
    const savedPrompt = localStorage.getItem(`speeldit_generate_prompt_${venueCode}`) || '';
    const savedPlaylistId = localStorage.getItem(`speeldit_generate_playlist_${venueCode}`) || 'pl_default';
    const rawCount = Number(localStorage.getItem(`speeldit_generate_count_${venueCode}`));
    const savedCount = (!isNaN(rawCount) && rawCount > 0 && rawCount <= 500) ? rawCount : 100;
    localStorage.removeItem(`speeldit_generate_${venueCode}`);
    localStorage.removeItem(`speeldit_generate_prompt_${venueCode}`);
    localStorage.removeItem(`speeldit_generate_playlist_${venueCode}`);
    localStorage.removeItem(`speeldit_generate_count_${venueCode}`);

    setGenerateStatus('generating');

    let mounted = true;
    api.generatePlaylist(venueCode, savedPlaylistId, checkoutId, savedPrompt, savedCount)
      .then((res) => { if (mounted) { setGenerateStatus({ added: res.data.added?.length ?? 0 }); loadVenue(); } })
      .catch((err) => { if (mounted) setGenerateStatus({ error: err.response?.data?.error || 'Generation failed' }); });
    return () => { mounted = false; };
  }, [venueCode]);

  const playlists = venue?.playlists || [];
  const activePlaylistId = venue?.activePlaylistId || playlists[0]?.id;
  const playlistSchedule = useMemo(() => venue?.settings?.playlistSchedule || [], [venue?.settings?.playlistSchedule]);
  const scheduledIds = useMemo(() => new Set(playlistSchedule.map((s) => s.playlistId)), [playlistSchedule]);

  const filtered = useMemo(() => {
    let list = playlists;
    if (selectedCategory === 'Has songs') list = list.filter((p) => (p.songs?.length || 0) > 0);
    if (selectedCategory === 'Empty') list = list.filter((p) => (p.songs?.length || 0) === 0);
    const q = query.trim().toLowerCase();
    if (q) list = list.filter((p) => (p.name || '').toLowerCase().includes(q));
    return list;
  }, [playlists, selectedCategory, query]);

  const featured = playlists.find((p) => p.id === activePlaylistId) || playlists[0];

  async function handleActivate(id) {
    if (!venueCode) return;
    setActionLoading(true);
    try {
      await api.activatePlaylist(venueCode, id);
      loadVenue();
      dispatchVenuePlayerMetaRefresh();
    } catch (e) {
      alert(e.response?.data?.error || 'Could not activate');
    }
    setActionLoading(false);
  }

  async function handleSaveSchedule(newSlotsForPlaylist) {
    if (!venueCode || !schedulePlaylistId) return;
    const cur = venue?.settings?.playlistSchedule || [];
    const others = cur.filter((s) => s.playlistId !== schedulePlaylistId);
    const merged = newSlotsForPlaylist.length > 0 ? [...others, ...newSlotsForPlaylist] : others;
    try {
      await api.updateSettings(venueCode, {
        playlistSchedule: merged.length > 0 ? merged : null,
      });
      loadVenue();
    } catch (e) {
      alert(e.response?.data?.error || 'Could not save schedule');
    }
  }

  function handleOpenPlaylist(id) {
    setOpenPlaylistId(id);
    setTimeout(() => {
      document.getElementById('playlist-manager')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 100);
  }

  const schedulePl = playlists.find((p) => p.id === schedulePlaylistId);

  if (loadError) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-zinc-50 to-zinc-100 flex items-center justify-center p-6">
        <p className="text-zinc-600">{loadError}</p>
      </div>
    );
  }

  if (!venue) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-zinc-50 to-zinc-100 flex items-center justify-center">
        <Loader2 className="w-10 h-10 text-brand-500 animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-zinc-50 to-zinc-100">
      <header className="sticky top-0 z-10 bg-white border-b border-zinc-200 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16 gap-2">
            <div className="flex items-center gap-3 min-w-0">
              <button
                type="button"
                onClick={() => navigate('/venue/dashboard')}
                className="p-2 hover:bg-zinc-100 rounded-lg transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center shrink-0"
                aria-label="Back"
              >
                <ArrowLeft className="w-5 h-5 text-zinc-700" />
              </button>
              <h1 className="text-zinc-900 font-bold text-lg truncate">Playlists</h1>
            </div>
            <div className="flex items-center gap-2">
              <div className="hidden sm:flex items-center border border-zinc-200 rounded-lg px-2 bg-zinc-50">
                <Search className="w-4 h-4 text-zinc-400 shrink-0" />
                <input
                  type="search"
                  placeholder="Search…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  className="bg-transparent border-0 text-sm py-2 px-2 w-40 lg:w-56 focus:outline-none focus:ring-0"
                />
              </div>
            </div>
          </div>
          <div className="sm:hidden pb-3 flex items-center border-t border-zinc-100 pt-2">
            <Search className="w-4 h-4 text-zinc-400 ml-2" />
            <input
              type="search"
              placeholder="Search playlists…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="flex-1 bg-transparent border-0 text-sm py-2 px-2 focus:outline-none"
            />
          </div>
        </div>
      </header>

      {generateStatus && (
        <div className={`border-b border-zinc-200 ${generateStatus === 'generating' ? 'bg-blue-50' : generateStatus.error ? 'bg-red-50' : 'bg-green-50'}`}>
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-2 flex items-center justify-between gap-3">
            <p className={`text-sm font-medium ${generateStatus === 'generating' ? 'text-blue-700' : generateStatus.error ? 'text-red-700' : 'text-green-700'}`}>
              {generateStatus === 'generating'
                ? 'Generating your AI playlist… this takes ~30 seconds'
                : generateStatus.error
                  ? `Generation failed: ${generateStatus.error}`
                  : `Added ${generateStatus.added} songs to your playlist!`}
            </p>
            {generateStatus !== 'generating' && (
              <button type="button" onClick={() => setGenerateStatus(null)} className="text-xs text-zinc-400 hover:text-zinc-600 shrink-0">Dismiss</button>
            )}
          </div>
        </div>
      )}

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8">
        <div className="mb-6 sm:mb-8">
          <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-thin">
            {categories.map((c) => (
              <CategoryPill
                key={c}
                label={c}
                isActive={selectedCategory === c}
                onClick={() => setSelectedCategory(c)}
              />
            ))}
          </div>
        </div>

        {selectedCategory === 'All' && !query && featured && (
          <div className="mb-8 sm:mb-10">
            <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wide mb-2">Now playing pool</p>
            <div className="rounded-xl overflow-hidden shadow-lg ring-1 ring-zinc-200 bg-black">
              <div className="min-h-[140px] sm:min-h-[168px] w-full flex flex-col justify-end p-4 sm:p-6">
                <h2 className="text-white text-xl sm:text-2xl font-bold">{featured.name}</h2>
                <p className="text-white/80 text-sm mt-1">
                  Active playlist · {featured.songs?.length || 0} songs
                </p>
              </div>
            </div>
          </div>
        )}

        {filtered.length === 0 ? (
          <p className="text-center text-zinc-500 py-16">No playlists match.</p>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4 sm:gap-6">
            {filtered.map((pl) => (
              <PlaylistCard
                key={pl.id}
                playlist={pl}
                songCount={pl.songs?.length || 0}
                coverUrl={pl.songs?.[0]?.albumArt}
                isActive={pl.id === activePlaylistId}
                isScheduled={scheduledIds.has(pl.id)}
                isLoading={actionLoading}
                onSelect={handleActivate}
                onSchedule={(id) => {
                  setSchedulePlaylistId(id);
                  setScheduleOpen(true);
                }}
                onOpen={handleOpenPlaylist}
              />
            ))}
          </div>
        )}

        {/* ── Playlist Manager: create, edit songs, search, AI generate ── */}
        <div id="playlist-manager" className="mt-10 max-w-3xl mx-auto">
          <PlaylistManager venueCode={venueCode} variant="light" initialPlaylistId={openPlaylistId} />
        </div>
      </main>

      <PlaylistScheduleModal
        isOpen={scheduleOpen}
        onClose={() => {
          setScheduleOpen(false);
          setSchedulePlaylistId(null);
        }}
        playlistId={schedulePlaylistId || ''}
        playlistName={schedulePl?.name || ''}
        existingSchedule={playlistSchedule}
        onSave={handleSaveSchedule}
      />
    </div>
  );
}
