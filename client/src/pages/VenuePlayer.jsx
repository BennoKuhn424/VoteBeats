import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Music2, ListMusic, LayoutList, ArrowLeft,
  Play, Pause, SkipBack, SkipForward, Volume2, Loader2,
} from 'lucide-react';
import api from '../utils/api';
import QueueManager from '../components/venue/QueueManager';
import PlaylistManager from '../components/venue/PlaylistManager';
import { formatDuration } from '../utils/helpers';
import { useVenuePlayback, PLAYER_STATES } from '../context/VenuePlaybackContext';

export default function VenuePlayer() {
  const { venueCode } = useParams();
  const navigate = useNavigate();

  const [venue, setVenue] = useState(null);
  const [activeTab, setActiveTab] = useState('playlist');
  const [generateStatus, setGenerateStatus] = useState(null);

  const {
    playerState,
    queue,
    fetchQueue,
    playbackTime,
    playbackDuration,
    isAuthorized,
    volume,
    setVolume,
    autoplayMode,
    playerError,
    autofillNotice,
    dismissAutofillNotice,
    retryInit,
    playPause,
    skip,
    restart,
    authorize,
    changeMode,
    initAutoplayMode,
    clearError,
  } = useVenuePlayback();

  const isPlaying = playerState === PLAYER_STATES.PLAYING;
  const isTransitioning = playerState === PLAYER_STATES.TRANSITIONING;
  const waitingForGesture = playerState === PLAYER_STATES.WAITING;
  const musicReady = playerState !== PLAYER_STATES.NOT_READY;

  // ── Wake Lock: keep screen on so JS stays alive for uninterrupted playback ─
  useEffect(() => {
    if (!('wakeLock' in navigator)) return;
    let lock = null;

    async function requestLock() {
      try {
        lock = await navigator.wakeLock.request('screen');
        lock.addEventListener('release', () => { lock = null; });
      } catch (_) {} // fails if tab is hidden or low battery — safe to ignore
    }

    requestLock();

    // Browser releases the lock when the tab is hidden; re-acquire on return
    function onVisibility() {
      if (document.visibilityState === 'visible' && !lock) requestLock();
    }
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      if (lock) lock.release().catch(() => {});
    };
  }, []);

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

    setActiveTab('playlist');
    setGenerateStatus('generating');

    let mounted = true;
    api.generatePlaylist(venueCode, savedPlaylistId, checkoutId, savedPrompt, savedCount)
      .then((res) => { if (mounted) setGenerateStatus({ added: res.data.added?.length ?? 0 }); })
      .catch((err) => { if (mounted) setGenerateStatus({ error: err.response?.data?.error || 'Generation failed' }); });
    return () => { mounted = false; };
  }, [venueCode]);

  // ── Fetch venue + sync autoplayMode ───────────────────────────────────────
  useEffect(() => {
    if (!venueCode) return;
    let mounted = true;
    api.getVenue(venueCode)
      .then((res) => {
        if (!mounted) return;
        setVenue(res.data);
        const saved = res.data?.settings?.autoplayMode;
        if (saved) initAutoplayMode(saved);
        else if (res.data?.settings?.autoplayQueue === false) initAutoplayMode('off');
      })
      .catch(() => { if (mounted) navigate('/venue/login'); });
    return () => { mounted = false; };
  }, [venueCode, navigate, initAutoplayMode]);

  async function handleRemoveSong(songId) {
    try { await api.removeSong(venueCode, songId); fetchQueue(); } catch {}
  }

  async function handleBanArtist(artist) {
    if (!artist) return;
    try {
      await api.banArtist(venueCode, artist);
    } catch {}
  }

  const nowPlaying = queue.nowPlaying;
  const progress = playbackDuration > 0 ? (playbackTime / playbackDuration) * 100 : 0;

  if (!venue) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-zinc-50 to-zinc-100 flex items-center justify-center">
        <div className="w-10 h-10 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-zinc-50 to-zinc-100 text-zinc-900 flex flex-col">
      <header className="border-b border-zinc-200 bg-white shrink-0">
        <div className="max-w-3xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => navigate('/venue/dashboard')}
              className="p-2 rounded-lg text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100 transition-colors"
            >
              <ArrowLeft className="h-5 w-5" />
            </button>
            <span className="font-bold text-zinc-900">{venue.name}</span>
          </div>
          <span className="text-xs font-mono bg-zinc-100 text-zinc-500 px-2 py-1 rounded">
            {venueCode}
          </span>
        </div>
      </header>

      <div className="bg-white border-b border-zinc-200 shrink-0">
        <div className="max-w-3xl mx-auto px-4 py-5">
          <div className="flex items-center gap-4 mb-4">
            <div className="w-16 h-16 rounded-xl shrink-0 overflow-hidden bg-zinc-100 flex items-center justify-center">
              {nowPlaying?.albumArt
                ? <img src={nowPlaying.albumArt} alt={nowPlaying.title} className="w-full h-full object-cover" />
                : <Music2 className="h-6 w-6 text-zinc-400" />}
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-bold text-zinc-900 truncate text-lg">
                {nowPlaying?.title || 'Nothing playing'}
              </p>
              <p className="text-sm text-zinc-500 truncate">
                {nowPlaying?.artist || 'Add songs to playlist or queue'}
              </p>
            </div>
          </div>

          {/* ── MusicKit initializing ────────────────────────────────────────── */}
          {!musicReady && (
            <div className="flex flex-col items-center gap-3 py-4 border-t border-zinc-100">
              <Loader2 className="h-6 w-6 animate-spin text-brand-500" />
              <p className="text-sm text-zinc-500 text-center">
                Connecting to Apple Music…
              </p>
            </div>
          )}

          {/* ── Apple Music not yet connected ────────────────────────────────── */}
          {musicReady && !isAuthorized && (
            <div className="flex flex-col items-center gap-3 py-4 border-t border-zinc-100">
              <p className="text-sm text-zinc-500 text-center">
                Connect Apple Music to enable playback
              </p>
              <button
                type="button"
                onClick={authorize}
                className="flex items-center gap-2 px-5 py-2.5 rounded-full bg-brand-500 text-white text-sm font-semibold hover:bg-brand-600 active:scale-95 transition-all"
              >
                <Music2 className="h-4 w-4" />
                Connect Apple Music
              </button>
            </div>
          )}

          {/* ── Playback controls — only when Apple Music is connected ───────── */}
          {isAuthorized && (
            <>
              <div className="mb-4">
                <div className="w-full bg-zinc-200 rounded-full h-1.5 overflow-hidden">
                  <div
                    className="bg-brand-500 h-1.5 rounded-full transition-all duration-500"
                    style={{ width: `${progress}%` }}
                  />
                </div>
                <div className="flex justify-between text-xs text-zinc-400 mt-1">
                  <span>{formatDuration(Math.floor(playbackTime))}</span>
                  <span>{formatDuration(Math.floor(playbackDuration))}</span>
                </div>
              </div>

              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={restart}
                    disabled={isTransitioning}
                    className="w-10 h-10 flex items-center justify-center rounded-full text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100 transition-colors disabled:opacity-40 disabled:pointer-events-none"
                  >
                    <SkipBack className="h-5 w-5" />
                  </button>
                  <div className="relative flex flex-col items-center gap-1">
                    <button
                      type="button"
                      onClick={playPause}
                      disabled={isTransitioning}
                      className={`w-14 h-14 flex items-center justify-center rounded-full text-white transition-all duration-200 disabled:opacity-60 disabled:pointer-events-none ${
                        isPlaying
                          ? 'bg-brand-500 hover:bg-brand-600 shadow-md'
                          : 'bg-brand-500 hover:bg-brand-600 shadow-lg ring-4 ring-brand-200 animate-pulse'
                      }`}
                    >
                      {isTransitioning
                        ? <Loader2 className="h-6 w-6 animate-spin" />
                        : isPlaying
                          ? <Pause className="h-6 w-6" />
                          : <Play className="h-6 w-6 ml-0.5" />}
                    </button>
                    <span className="text-xs font-medium text-zinc-500 select-none">
                      {isTransitioning ? 'Loading…' : isPlaying ? 'Playing' : waitingForGesture ? 'Tap to play' : 'Paused'}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={skip}
                    disabled={isTransitioning}
                    className="w-10 h-10 flex items-center justify-center rounded-full text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100 transition-colors disabled:opacity-40 disabled:pointer-events-none"
                  >
                    <SkipForward className="h-5 w-5" />
                  </button>
                </div>
                <div className="flex items-center gap-2 flex-1 max-w-xs">
                  <Volume2 className="h-4 w-4 text-zinc-400 shrink-0" />
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={volume}
                    onChange={(e) => setVolume(Number(e.target.value))}
                    className="w-full accent-brand-500 cursor-pointer"
                    style={{ height: '4px' }}
                  />
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2 mt-4 pt-4 border-t border-zinc-200">
                <span className="text-xs text-zinc-500 mr-1">Autoplay:</span>
                {[
                  { id: 'off', label: 'Off' },
                  { id: 'playlist', label: 'Playlist' },
                  { id: 'random', label: 'Random' },
                ].map(({ id, label }) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => changeMode(id)}
                    className={`px-4 py-2 rounded-full text-xs font-semibold transition-colors min-h-[36px] ${
                      autoplayMode === id
                        ? 'bg-brand-500 text-white'
                        : 'bg-zinc-100 text-zinc-500 hover:text-zinc-900'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      <div className="border-b border-zinc-200 bg-white shrink-0">
        <div className="max-w-3xl mx-auto px-4">
          <div className="flex gap-1 py-2">
            {[
              { id: 'playlist', Icon: ListMusic, label: 'Playlist' },
              { id: 'queue', Icon: LayoutList, label: 'Queue' },
            ].map(({ id, Icon, label }) => (
              <button
                key={id}
                type="button"
                onClick={() => setActiveTab(id)}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                  activeTab === id
                    ? 'bg-brand-500 text-white'
                    : 'text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100'
                }`}
              >
                <Icon className="h-4 w-4" />
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {generateStatus && (
        <div className={`shrink-0 border-b border-zinc-200 ${generateStatus === 'generating' ? 'bg-blue-50' : generateStatus.error ? 'bg-red-50' : 'bg-green-50'}`}>
          <div className="max-w-3xl mx-auto px-4 py-2 flex items-center justify-between gap-3">
            <p className={`text-sm font-medium ${generateStatus === 'generating' ? 'text-blue-700' : generateStatus.error ? 'text-red-700' : 'text-green-700'}`}>
              {generateStatus === 'generating'
                ? '✨ Generating your AI playlist… this takes ~30 seconds'
                : generateStatus.error
                  ? `Generation failed: ${generateStatus.error}`
                  : `✅ Added ${generateStatus.added} songs to your playlist!`}
            </p>
            {generateStatus !== 'generating' && (
              <button type="button" onClick={() => setGenerateStatus(null)} className="text-xs text-zinc-400 hover:text-zinc-600 shrink-0">Dismiss</button>
            )}
          </div>
        </div>
      )}

      {playerError && (
        <div className="shrink-0 border-b border-zinc-200 bg-red-50">
          <div className="max-w-3xl mx-auto px-4 py-2 flex items-center justify-between gap-3">
            <p className="text-sm font-medium text-red-700">{playerError}</p>
            <div className="flex items-center gap-2 shrink-0">
              <button type="button" onClick={retryInit} className="text-xs px-3 py-1.5 rounded-lg bg-red-600 text-white hover:bg-red-700">Retry</button>
              <button type="button" onClick={clearError} className="text-xs text-zinc-400 hover:text-zinc-600">Dismiss</button>
            </div>
          </div>
        </div>
      )}

      {autofillNotice && (
        <div className="shrink-0 border-b border-zinc-200 bg-amber-50">
          <div className="max-w-3xl mx-auto px-4 py-2 flex items-center justify-between gap-3">
            <p className="text-sm font-medium text-amber-700">No songs found for autoplay — add tracks to your playlist</p>
            <button type="button" onClick={dismissAutofillNotice} className="text-xs text-zinc-400 hover:text-zinc-600 shrink-0">Dismiss</button>
          </div>
        </div>
      )}

      <main className="flex-1 max-w-3xl w-full mx-auto px-4 py-6">
        {activeTab === 'playlist' && <PlaylistManager venueCode={venueCode} variant="light" />}
        {activeTab === 'queue' && (
          <QueueManager queue={queue} onSkip={skip} onRemove={handleRemoveSong} onBan={handleBanArtist} variant="light" />
        )}
      </main>
    </div>
  );
}
