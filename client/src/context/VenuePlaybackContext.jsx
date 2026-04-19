import { createContext, useContext, useEffect } from 'react';
import { usePlaybackRefs } from '../hooks/playback/usePlaybackRefs';
import { usePlaybackEngine } from '../hooks/playback/usePlaybackEngine';
import { useMusicKitInit } from '../hooks/playback/useMusicKitInit';
import { useQueueSync } from '../hooks/playback/useQueueSync';
import { useHealthCheck } from '../hooks/playback/useHealthCheck';
import { useMediaSession } from '../hooks/playback/useMediaSession';
import { useVolumeControl } from '../hooks/playback/useVolumeControl';
import { usePlayerControls } from '../hooks/playback/usePlayerControls';
import api from '../utils/api';

// Re-export constants so consumers don't need to change imports
export { PLAYER_STATES } from '../hooks/playback/constants';

const VenuePlaybackContext = createContext(null);

export function useVenuePlayback() {
  return useContext(VenuePlaybackContext);
}

/**
 * Thin orchestrator: composes domain-specific hooks into a single context.
 *
 * Each hook owns one responsibility. Cross-hook communication goes through
 * the shared refs bag (usePlaybackRefs). The context value is the public
 * API — all MusicKit internals are private.
 */
export function VenuePlaybackProvider({ venueCode, children }) {
  const refs = usePlaybackRefs();

  // ── Core engine: state machine, transitions, playSong ───────────────────
  const engine = usePlaybackEngine(refs, venueCode);

  // ── Queue sync: socket.io, HTTP fetch, autofill ─────────────────────────
  const queueSync = useQueueSync(refs, venueCode, {
    beginTransition: engine.beginTransition,
    endTransition: engine.endTransition,
    updatePlayerState: engine.updatePlayerState,
  });

  // ── MusicKit init: setup, event listeners, auth ─────────────────────────
  const musicKit = useMusicKitInit(refs, venueCode, {
    updatePlayerState: engine.updatePlayerState,
    setPlayerError: engine.setPlayerError,
    setErrorWithPriority: engine.setErrorWithPriority,
    setQueue: queueSync.setQueue,
  });

  // ── Volume ──────────────────────────────────────────────────────────────
  const volumeControl = useVolumeControl(refs, venueCode);

  // Set initial MusicKit volume when it becomes available
  useEffect(() => {
    if (refs.provider) refs.provider.setVolume(volumeControl.volume);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [musicKit.isAuthorized]);

  // ── Player controls ─────────────────────────────────────────────────────
  const controls = usePlayerControls(refs, venueCode, {
    playSong: engine.playSong,
    beginTransition: engine.beginTransition,
    endTransition: engine.endTransition,
    updatePlayerState: engine.updatePlayerState,
    setErrorWithPriority: engine.setErrorWithPriority,
    setIsAuthorized: musicKit.setIsAuthorized,
    setQueue: queueSync.setQueue,
    fetchQueue: queueSync.fetchQueue,
  });

  // ── Health check ────────────────────────────────────────────────────────
  useHealthCheck(refs, venueCode, {
    fetchQueue: queueSync.fetchQueue,
    setErrorWithPriority: engine.setErrorWithPriority,
  });

  // ── Media Session (lock screen) ─────────────────────────────────────────
  useMediaSession({
    queue: queueSync.queue,
    playerState: engine.playerState,
    playbackTime: musicKit.playbackTime,
    playbackDuration: musicKit.playbackDuration,
    playPause: controls.playPause,
    skip: controls.skip,
    restart: controls.restart,
  });

  // ── Network recovery: reset error state when coming back online ─────────
  useEffect(() => {
    function onOnline() {
      refs.playFailCount = 0;
      engine.setPlayerError(null);
      refs.hcLastFired = {};
      refs.stuckSince = null;
      refs.divergenceSince = null;
    }
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, [refs, engine]);

  // ── Periodic position report: keep server anchor accurate ───────────────
  useEffect(() => {
    const interval = setInterval(() => {
      const provider = refs.provider;
      const songId = refs.currentSongId;
      if (!provider || !songId || provider.playbackState !== 2) return;
      if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
      api.reportPlaying(venueCode, songId, provider.currentPlaybackTime || 0).catch(() => {});
    }, 30000);
    return () => clearInterval(interval);
  }, [refs, venueCode]);

  // ── Public API ──────────────────────────────────────────────────────────
  const value = {
    playerState: engine.playerState,
    playbackLoading: engine.playbackLoading,
    queue: queueSync.queue,
    fetchQueue: queueSync.fetchQueue,
    playbackTime: musicKit.playbackTime,
    playbackDuration: musicKit.playbackDuration,
    isAuthorized: musicKit.isAuthorized,
    volume: volumeControl.volume,
    setVolume: volumeControl.setVolume,
    autoplayMode: controls.autoplayMode,
    playerError: engine.playerError,
    autofillNotice: queueSync.autofillNotice,
    dismissAutofillNotice: queueSync.dismissAutofillNotice,
    playPause: controls.playPause,
    skip: controls.skip,
    restart: controls.restart,
    authorize: controls.authorize,
    changeMode: controls.changeMode,
    initAutoplayMode: controls.initAutoplayMode,
    clearError: engine.clearError,
    retryInit: musicKit.retryInit,
  };

  return (
    <VenuePlaybackContext.Provider value={value}>
      {children}
    </VenuePlaybackContext.Provider>
  );
}
