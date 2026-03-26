import { useState, useEffect, useMemo } from 'react';
import { useLocation, Link } from 'react-router-dom';
import {
  Music2, Play, Pause, SkipBack, SkipForward, Volume2, Loader2,
} from 'lucide-react';
import api from '../../utils/api';
import { formatDuration } from '../../utils/helpers';
import { VENUE_PLAYER_META_REFRESH } from '../../utils/venuePlayerEvents';
import { useVenuePlayback, PLAYER_STATES } from '../../context/VenuePlaybackContext';

const AUTOPLAY_OPTIONS = [
  { id: 'off', label: 'Off' },
  { id: 'playlist', label: 'Playlist' },
  { id: 'random', label: 'Random' },
];

/**
 * Sticky Rockbot-style player strip: always visible under /venue/* while logged in.
 */
export default function VenuePlayerBar({ venueCode }) {
  const location = useLocation();
  const [venueMeta, setVenueMeta] = useState(null);

  const {
    playerState,
    queue,
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
    playbackLoading,
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
  const busyPlayback = isTransitioning || playbackLoading;

  const nowPlaying = queue.nowPlaying;
  const rawProgress = playbackDuration > 0 ? (playbackTime / playbackDuration) * 100 : 0;
  const progress = Number.isFinite(rawProgress) ? Math.min(rawProgress, 100) : 0;

  const activePlaylistName = useMemo(() => {
    if (!venueMeta?.playlists?.length) return null;
    const id = venueMeta.activePlaylistId || venueMeta.playlists[0]?.id;
    return venueMeta.playlists.find((p) => p.id === id)?.name ?? null;
  }, [venueMeta]);

  useEffect(() => {
    if (!('wakeLock' in navigator)) return;
    let lock = null;
    async function requestLock() {
      try {
        lock = await navigator.wakeLock.request('screen');
        lock.addEventListener('release', () => { lock = null; });
      } catch (_) {}
    }
    requestLock();
    function onVisibility() {
      if (document.visibilityState === 'visible' && !lock) requestLock();
    }
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      if (lock) lock.release().catch(() => {});
    };
  }, []);

  // Full sync when venue or page changes (autoplay mode from server).
  useEffect(() => {
    if (!venueCode) return;
    let cancelled = false;
    api.getVenue(venueCode)
      .then((res) => {
        if (cancelled) return;
        const data = res.data;
        setVenueMeta(data);
        const saved = data?.settings?.autoplayMode;
        if (saved) initAutoplayMode(saved);
        else if (data?.settings?.autoplayQueue === false) initAutoplayMode('off');
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [venueCode, location.pathname, initAutoplayMode]);

  // Light refresh for active playlist name (no autoplayMode overwrite — avoids racing changeMode).
  useEffect(() => {
    if (!venueCode) return;
    let cancelled = false;
    const loadMeta = () => {
      api.getVenue(venueCode)
        .then((res) => {
          if (cancelled) return;
          setVenueMeta(res.data);
        })
        .catch(() => {});
    };
    const t = setInterval(loadMeta, 45000);
    const onFocus = () => loadMeta();
    const onMetaRefresh = () => loadMeta();
    window.addEventListener('focus', onFocus);
    window.addEventListener(VENUE_PLAYER_META_REFRESH, onMetaRefresh);
    return () => {
      cancelled = true;
      clearInterval(t);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener(VENUE_PLAYER_META_REFRESH, onMetaRefresh);
    };
  }, [venueCode]);

  if (!venueCode) return null;

  return (
    <div className="sticky top-0 z-40 shrink-0 bg-white border-b border-zinc-200 shadow-sm">
      <div className="px-3 sm:px-4 py-3 flex flex-wrap items-center gap-x-4 gap-y-2.5">
        {/* Track */}
        <div className="flex items-center gap-3 min-w-0 max-w-[220px] sm:max-w-[280px]">
          <div className="w-12 h-12 sm:w-14 sm:h-14 rounded-xl shrink-0 overflow-hidden bg-zinc-100 flex items-center justify-center">
            {nowPlaying?.albumArt ? (
              <img src={nowPlaying.albumArt} alt="" className="w-full h-full object-cover" />
            ) : (
              <Music2 className="h-5 w-5 sm:h-6 sm:w-6 text-zinc-400" />
            )}
          </div>
          <div className="min-w-0">
            <p className="text-base font-semibold text-zinc-900 truncate leading-snug">
              {nowPlaying?.title || 'Nothing playing'}
            </p>
            <p className="text-sm text-zinc-500 truncate leading-snug">
              {nowPlaying?.artist || '—'}
            </p>
          </div>
        </div>

        {/* Progress */}
        <div className="flex-1 min-w-[160px] order-last sm:order-none w-full sm:w-auto basis-full sm:basis-auto">
          <div className="w-full bg-zinc-200 rounded-full h-1.5 sm:h-2 overflow-hidden">
            <div
              className="bg-brand-500 h-1.5 sm:h-2 rounded-full transition-all duration-500"
              style={{ width: `${progress}%` }}
            />
          </div>
          <div className="flex justify-between text-xs text-zinc-400 mt-1 tabular-nums">
            <span>{formatDuration(Math.floor(playbackTime))}</span>
            <span>{formatDuration(Math.floor(playbackDuration))}</span>
          </div>
        </div>

        {/* Status + transport */}
        <div className="flex items-center gap-2.5 shrink-0">
          {!musicReady && (
            <div className="flex items-center gap-2 text-zinc-500 pr-1">
              <Loader2 className="h-5 w-5 animate-spin text-brand-500" />
              <span className="text-sm hidden md:inline">Connecting to Apple Music…</span>
            </div>
          )}
          {musicReady && !isAuthorized && (
            <button
              type="button"
              onClick={authorize}
              className="flex items-center gap-1.5 px-4 py-2 rounded-full bg-brand-500 text-white text-sm font-semibold hover:bg-brand-600 whitespace-nowrap min-h-[44px]"
            >
              <Music2 className="h-4 w-4 shrink-0" />
              Connect
            </button>
          )}
          {isAuthorized && (
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={restart}
                disabled={busyPlayback}
                className="w-10 h-10 flex items-center justify-center rounded-full text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100 disabled:opacity-40"
                aria-label="Back to start"
              >
                <SkipBack className="h-5 w-5" />
              </button>
              <button
                type="button"
                onClick={playPause}
                disabled={busyPlayback}
                className="w-12 h-12 sm:w-14 sm:h-14 flex items-center justify-center rounded-full text-white bg-brand-500 hover:bg-brand-600 shadow-md disabled:opacity-60"
                aria-label={isPlaying ? 'Pause' : 'Play'}
              >
                {busyPlayback ? (
                  <Loader2 className="h-6 w-6 animate-spin" />
                ) : isPlaying ? (
                  <Pause className="h-6 w-6 sm:h-7 sm:w-7" />
                ) : (
                  <Play className="h-6 w-6 sm:h-7 sm:w-7 ml-0.5" />
                )}
              </button>
              <button
                type="button"
                onClick={skip}
                disabled={busyPlayback}
                className="w-10 h-10 flex items-center justify-center rounded-full text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100 disabled:opacity-40"
                aria-label="Next"
              >
                <SkipForward className="h-5 w-5" />
              </button>
              <span className="text-xs font-medium text-brand-600 w-20 text-center hidden md:inline select-none">
                {busyPlayback ? 'Loading…' : isPlaying ? 'Playing' : waitingForGesture ? 'Tap play' : 'Paused'}
              </span>
            </div>
          )}
        </div>

        {isAuthorized && (
          <div className="flex items-center gap-2 shrink-0 w-32 sm:w-40">
            <Volume2 className="h-4 w-4 text-zinc-400 shrink-0" />
            <input
              type="range"
              min="0"
              max="100"
              value={volume}
              onChange={(e) => setVolume(Number(e.target.value))}
              className="w-full accent-brand-500 cursor-pointer h-2"
            />
          </div>
        )}

        {/* Autoplay + active playlist label */}
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <span className="text-xs text-zinc-500 font-medium">Autoplay</span>
          {AUTOPLAY_OPTIONS.map(({ id, label }) => (
            <button
              key={id}
              type="button"
              onClick={() => changeMode(id)}
              className={`px-3.5 py-1.5 rounded-full text-xs font-semibold transition-colors min-h-[36px] ${
                autoplayMode === id
                  ? 'bg-brand-500 text-white'
                  : 'bg-zinc-100 text-zinc-500 hover:text-zinc-900'
              }`}
            >
              {label}
            </button>
          ))}
          {autoplayMode === 'playlist' && activePlaylistName && (
            <Link
              to="/venue/playlists"
              className="text-xs text-zinc-700 max-w-[200px] truncate hover:text-brand-600 hover:underline font-medium ml-0.5"
              title={activePlaylistName}
            >
              {activePlaylistName}
            </Link>
          )}
        </div>
      </div>

      {playerError && (
        <div className="border-t border-red-100 bg-red-50 px-3 py-1.5 flex items-center justify-between gap-2">
          <p className="text-xs font-medium text-red-700 min-w-0 truncate">{playerError}</p>
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={retryInit}
              className="text-[10px] px-2 py-1 rounded-md bg-red-600 text-white hover:bg-red-700"
            >
              Retry
            </button>
            <button type="button" onClick={clearError} className="text-[10px] text-zinc-500 hover:text-zinc-700">
              Dismiss
            </button>
          </div>
        </div>
      )}

      {autofillNotice && (
        <div className="border-t border-amber-100 bg-amber-50 px-3 py-1.5 flex items-center justify-between gap-2">
          <p className="text-xs font-medium text-amber-800 min-w-0">
            No songs for autoplay — add tracks in Playlists
          </p>
          <button
            type="button"
            onClick={dismissAutofillNotice}
            className="text-[10px] text-zinc-500 hover:text-zinc-700 shrink-0"
          >
            Dismiss
          </button>
        </div>
      )}
    </div>
  );
}
