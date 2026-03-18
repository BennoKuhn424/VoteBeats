import { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';
import api from '../utils/api';
import socket from '../utils/socket';
import { useVisibilityAwarePolling } from '../hooks/useVisibilityAwarePolling';

const VenuePlaybackContext = createContext(null);

export function useVenuePlayback() {
  return useContext(VenuePlaybackContext);
}

export function VenuePlaybackProvider({ venueCode, children }) {
  const [queue, setQueue] = useState({ nowPlaying: null, upcoming: [] });
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackTime, setPlaybackTime] = useState(0);
  const [playbackDuration, setPlaybackDuration] = useState(0);
  const [isAuthorized, setIsAuthorized] = useState(false);
  const [musicReady, setMusicReady] = useState(false);
  const [waitingForGesture, setWaitingForGesture] = useState(false);
  const [autoplayMode, setAutoplayMode] = useState('playlist');
  const [playerError, setPlayerError] = useState(null);
  const [autofillNotice, setAutofillNotice] = useState(false);
  // Incremented by retryInit() to re-run the MusicKit init effect
  const [initKey, setInitKey] = useState(0);
  const [volume, setVolume] = useState(() => {
    const parsed = Number(localStorage.getItem('speeldit_volume'));
    return (!isNaN(parsed) && parsed >= 0) ? Math.min(parsed, 100) : 70;
  });

  const [isTransitioning, setIsTransitioning] = useState(false);

  const musicRef = useRef(null);
  const currentSongIdRef = useRef(null);
  const isTransitioningRef = useRef(false);
  const transitionWatchdogRef = useRef(null);
  const autoplayModeRef = useRef(autoplayMode);
  const autofill404UntilRef = useRef(0);
  const autofillBackoffRef = useRef(5000); // escalates: 5s → 10s → 20s → 30s
  const playFailCountRef = useRef(0);       // consecutive playSong non-interaction failures
  const queueRef = useRef(queue);           // stable ref for health-check interval
  const stuckSinceRef = useRef(null);       // timestamp when player went idle while server has nowPlaying
  const divergenceSinceRef = useRef(null); // timestamp of first track-divergence detection (cooldown)
  const autofillDismissedAtRef = useRef(0); // timestamp of last manual autofill notice dismiss
  // True once the user has clicked something on this page — required before
  // any music.play() call to satisfy browser autoplay policy.
  const hasUserGestureRef = useRef(false);
  // Stable ref so playPause() always reads the latest value without
  // needing waitingForGesture in its dependency array.
  const waitingForGestureRef = useRef(false);

  // Internal error codes — used in logs so you can grep production output
  // by code rather than by the display string (which can change freely).
  // APPLE_INIT_FAIL  → MusicKit configure/token failed
  // PLAY_FAIL_RETRY  → playSong failed once, retrying
  // PLAY_FAIL_ATTN   → playSong failed 3+ times, needs manual intervention
  // PLAYER_WATCHDOG  → transition stuck >10s, force-reset
  // HC_PLAYER_STUCK  → health check: server has song but MusicKit idle >15s
  // HC_TRACK_DIV     → health check: MusicKit playing different track than server

  // Error priority — lower number = higher priority.
  // Only overwrite current error if the new one is equally or more critical,
  // so a soft "retrying…" notice never silences an auth failure banner.
  const ERROR_PRIORITY = {
    'Could not connect to Apple Music — tap Retry': 1,   // APPLE_INIT_FAIL
    'Player needs attention — tap to reconnect Apple Music': 2, // PLAY_FAIL_ATTN
    'Player disconnected — tap to reset': 3,             // HC_TRACK_DIV / HC_PLAYER_STUCK
    'Something went wrong — tap Play to retry': 4,       // PLAYER_WATCHDOG
    'Playback failed — retrying…': 5,                    // PLAY_FAIL_RETRY
  };
  const setErrorWithPriority = useCallback((newMsg) => {
    setPlayerError((prev) => {
      if (!newMsg) return null;
      const newP = ERROR_PRIORITY[newMsg] ?? 99;
      const prevP = ERROR_PRIORITY[prev] ?? 99;
      return newP <= prevP ? newMsg : prev;
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const dismissAutofillNotice = useCallback(() => {
    autofillDismissedAtRef.current = Date.now();
    setAutofillNotice(false);
  }, []);

  // beginTransition / endTransition keep the ref (for fast checks) and the
  // state (for UI disabled/spinner) in sync, and run a 10-second watchdog so
  // a crash mid-transition can never leave the player permanently frozen.
  const beginTransition = useCallback(() => {
    isTransitioningRef.current = true;
    setIsTransitioning(true);
    clearTimeout(transitionWatchdogRef.current);
    transitionWatchdogRef.current = setTimeout(() => {
      if (isTransitioningRef.current) {
        console.warn('[PLAYER_WATCHDOG] transition stuck >10 s — forcing reset');
        isTransitioningRef.current = false;
        setIsTransitioning(false);
        setErrorWithPriority('Something went wrong — tap Play to retry');
      }
    }, 10000);
  }, [setErrorWithPriority]);

  const endTransition = useCallback(() => {
    clearTimeout(transitionWatchdogRef.current);
    isTransitioningRef.current = false;
    setIsTransitioning(false);
  }, []);

  useEffect(() => { autoplayModeRef.current = autoplayMode; }, [autoplayMode]);
  useEffect(() => { queueRef.current = queue; }, [queue]);
  useEffect(() => { waitingForGestureRef.current = waitingForGesture; }, [waitingForGesture]);

  // ── Initialize MusicKit ──────────────────────────────────────────────────
  useEffect(() => {
    if (!venueCode) return;
    const token = localStorage.getItem('speeldit_token');
    if (!token) return;

    let stateListener = null;
    let timeListener = null;

    async function init() {
      try {
        let music;
        try { music = MusicKit.getInstance(); } catch {}
        if (!music) {
          const res = await api.getDeveloperToken();
          const devToken = res.data?.token || res.data?.developerToken;
          if (!devToken) {
            setPlayerError('Could not connect to Apple Music — tap Retry');
            return;
          }
          await MusicKit.configure({
            developerToken: devToken,
            app: { name: 'Speeldit', build: '1.0' },
          });
          music = MusicKit.getInstance();
        }
        musicRef.current = music;
        music.volume = volume / 100;
        setIsAuthorized(music.isAuthorized);
        setMusicReady(true);
        setPlayerError(null); // clear any previous init error
        setIsPlaying(music.playbackState === 2);
        setPlaybackTime(music.currentPlaybackTime || 0);
        setPlaybackDuration(music.currentPlaybackDuration || 0);

        stateListener = () => { setIsPlaying(music.playbackState === 2); };
        timeListener = () => {
          setPlaybackTime(music.currentPlaybackTime || 0);
          setPlaybackDuration(music.currentPlaybackDuration || 0);
        };
        music.addEventListener('playbackStateDidChange', stateListener);
        music.addEventListener('playbackTimeDidChange', timeListener);
      } catch (err) {
        console.error('[APPLE_INIT_FAIL] MusicKit init error:', err);
        setPlayerError('Could not connect to Apple Music — tap Retry');
      }
    }
    init();

    return () => {
      const music = musicRef.current;
      if (music) {
        if (stateListener) music.removeEventListener('playbackStateDidChange', stateListener);
        if (timeListener) music.removeEventListener('playbackTimeDidChange', timeListener);
      }
    };
  }, [venueCode, initKey]); // initKey lets retryInit() re-run this effect

  const retryInit = useCallback(() => {
    setPlayerError(null);
    setInitKey((k) => k + 1);
  }, []);

  useEffect(() => {
    localStorage.setItem('speeldit_volume', String(volume));
    if (musicRef.current) musicRef.current.volume = volume / 100;
  }, [volume]);

  const playSong = useCallback(async (song) => {
    const music = musicRef.current;
    if (!music || !song?.appleId) return;
    try {
      if (!music.isAuthorized) {
        await music.authorize();
        setIsAuthorized(music.isAuthorized);
      }
      // Bring player to a stable idle state before loading a new queue.
      // Always attempt both — state 1 (loading) also needs pause() before stop().
      // All errors are swallowed; after stop() the player is in state 0.
      try { await music.pause(); } catch {}
      try { await music.stop(); } catch {}
      await music.setQueue({ songs: [song.appleId] });
      await music.play();
      setWaitingForGesture(false);
      setPlayerError(null);
      playFailCountRef.current = 0; // reset consecutive failure count
      await api.reportPlaying(venueCode, song.id, 0);
    } catch (err) {
      if (err?.message?.toLowerCase().includes('interact') || err?.name === 'NotAllowedError') {
        setWaitingForGesture(true);
      } else {
        console.error('Play error:', err);
        // Clear ref so the next tap triggers a fresh load attempt
        currentSongIdRef.current = null;
        playFailCountRef.current += 1;
        if (playFailCountRef.current >= 3) {
          console.warn('[PLAY_FAIL_ATTN] playSong failed 3+ times consecutively');
          setErrorWithPriority('Player needs attention — tap to reconnect Apple Music');
          playFailCountRef.current = 0;
        } else {
          console.warn(`[PLAY_FAIL_RETRY] playSong failed (attempt ${playFailCountRef.current}):`, err?.message);
          setErrorWithPriority('Playback failed — retrying…');
        }
      }
      endTransition(); // safety: ensure isTransitioningRef never stays stuck
    }
  }, [venueCode, endTransition, setErrorWithPriority]);

  const tryAutofill = useCallback(async () => {
    if (autoplayModeRef.current === 'off') return false;
    if (Date.now() < autofill404UntilRef.current) return false;
    try {
      const res = await api.autofillQueue(venueCode);
      if (res.data?.filled === false) {
        // Server found no songs — apply backoff without a red 404 in the console
        const backoff = autofillBackoffRef.current;
        autofill404UntilRef.current = Date.now() + backoff;
        console.warn(`Autofill: no songs — backing off ${backoff / 1000}s.`);
        autofillBackoffRef.current = Math.min(backoff * 2, 30000);
        // Show notice immediately — but respect a 5-minute cooldown after a
        // manual dismiss so repeated backoffs don't cause "alert fatigue".
        const NOTICE_COOLDOWN_MS = 5 * 60 * 1000;
        if (Date.now() - autofillDismissedAtRef.current > NOTICE_COOLDOWN_MS) {
          setAutofillNotice(true);
        }
        return false;
      }
      autofillBackoffRef.current = 5000; // reset on success
      setAutofillNotice(false);
      return true;
    } catch (err) {
      console.error('Autofill error:', err);
      return false;
    }
  }, [venueCode]);

  const handleQueueUpdate = useCallback(async (newQueue) => {
    setQueue(newQueue);
    const nowPlaying = newQueue.nowPlaying;

    if (nowPlaying && nowPlaying.id !== currentSongIdRef.current && !isTransitioningRef.current) {
      const currentAppleId = musicRef.current?.nowPlayingItem?.id;
      if (currentAppleId && String(currentAppleId) === String(nowPlaying.appleId)) {
        currentSongIdRef.current = nowPlaying.id;
      } else if (musicRef.current?.playbackState === 3) {
        // Paused — don't force a new song; user will unpause manually
      } else if (!hasUserGestureRef.current) {
        // Page just loaded — no user gesture yet. Show "Tap to play" instead of
        // calling music.play() which would trigger the browser autoplay dialog.
        setWaitingForGesture(true);
      } else {
        try {
          beginTransition();
          currentSongIdRef.current = nowPlaying.id;
          await playSong(nowPlaying);
        } finally {
          endTransition();
        }
      }
    }

    if (!nowPlaying && autoplayModeRef.current !== 'off' && !isTransitioningRef.current) {
      const filled = await tryAutofill();
      if (filled) {
        try {
          const r = await api.getQueue(venueCode);
          setQueue(r.data);
          const np = r.data?.nowPlaying;
          if (np?.appleId && np.id !== currentSongIdRef.current && !isTransitioningRef.current) {
            try {
              beginTransition();
              currentSongIdRef.current = np.id;
              await playSong(np);
            } finally {
              endTransition();
            }
          }
        } catch {}
      }
    }
  }, [venueCode, playSong, tryAutofill, beginTransition, endTransition]);

  const fetchQueue = useCallback(async () => {
    if (!venueCode) return;
    try {
      // Short timeout: fail fast so the next poll cycle (15 s) can retry
      // instead of blocking for 30 s (3 × 10 s retries).
      const res = await api.getQueue(venueCode, undefined, { timeout: 5000, 'axios-retry': { retries: 1 } });
      await handleQueueUpdate(res.data);
    } catch (err) {
      // Swallow — don't crash the player on a transient network blip
      console.warn('Queue fetch failed:', err?.message);
    }
  }, [venueCode, handleQueueUpdate]);

  // ── Socket.IO — primary real-time updates ────────────────────────────────
  useEffect(() => {
    if (!venueCode) return;

    function joinRoom() {
      socket.emit('join', venueCode);
    }

    socket.connect();
    joinRoom();

    function onConnect() {
      // Re-join venue room after any reconnection (iOS resume, network switch)
      joinRoom();
      // Re-fetch so we catch any updates missed during the disconnection window
      setTimeout(fetchQueue, 300);
    }

    socket.on('connect', onConnect);
    socket.on('queue:updated', handleQueueUpdate);

    // Initial fetch
    fetchQueue();

    return () => {
      // Pass explicit handler references so we only remove our own listeners
      // and don't accidentally clear handlers added by other effects.
      socket.off('connect', onConnect);
      socket.off('queue:updated', handleQueueUpdate);
      socket.disconnect();
    };
  }, [venueCode, fetchQueue, handleQueueUpdate]);

  // ── Fallback poll — visibility-aware, 15s, pauses when backgrounded ──────
  useVisibilityAwarePolling(fetchQueue, 15000);

  // ── MusicKit song-ended handler ──────────────────────────────────────────
  useEffect(() => {
    const music = musicRef.current;
    if (!music || !venueCode) return;

    async function onStateChange() {
      if (music.playbackState === 5 && currentSongIdRef.current) {
        const endedSongId = currentSongIdRef.current;
        currentSongIdRef.current = null;
        beginTransition();
        try {
          // /advance runs autofill internally and returns nowPlaying in one
          // round-trip — no follow-up GET /queue or GET /autofill needed.
          const res = await api.advanceQueue(venueCode, endedSongId);
          if (autoplayModeRef.current !== 'off') {
            const np = res.data?.nowPlaying;
            if (np?.appleId) {
              setQueue((prev) => ({ ...prev, nowPlaying: np }));
              currentSongIdRef.current = np.id;
              await playSong(np);
            } else {
              // Server returned no next song (empty playlist / autofill failed).
              // Do one reconciling fetch so the UI reflects the real server state.
              fetchQueue();
            }
          }
        } catch (err) {
          console.error('Advance error:', err);
        } finally {
          endTransition();
        }
      }
    }
    music.addEventListener('playbackStateDidChange', onStateChange);
    return () => music.removeEventListener('playbackStateDidChange', onStateChange);
  }, [venueCode, playSong, fetchQueue, beginTransition, endTransition]);

  // ── Auto-clear autofill notice when a song starts ───────────────────────
  useEffect(() => {
    if (queue.nowPlaying) setAutofillNotice(false);
  }, [queue.nowPlaying]);

  // ── Health check: detect MusicKit / server state divergence ─────────────
  // Every 12 s check two conditions:
  // 1. Player is playing but on a different track than the server expects.
  // 2. Server has nowPlaying but MusicKit has been idle/ended for >15 s
  //    (e.g. after an Apple Music popup killed playback).
  useEffect(() => {
    if (!venueCode) return;
    const interval = setInterval(() => {
      const music = musicRef.current;
      if (!music) return;
      const serverNowPlaying = queueRef.current?.nowPlaying;
      const state = music.playbackState;

      if (state === 2) {
        // Playing — reset stuck timer and check track divergence
        stuckSinceRef.current = null;
        const serverAppleId = String(serverNowPlaying?.appleId || '');
        const clientAppleId = String(music.nowPlayingItem?.id || '');
        if (serverAppleId && clientAppleId && serverAppleId !== clientAppleId) {
          // Only escalate after two consecutive divergent checks (~24 s apart)
          // to avoid false positives during transient MusicKit state changes.
          if (!divergenceSinceRef.current) {
            divergenceSinceRef.current = Date.now();
            console.warn('[HC_TRACK_DIVERGENCE] first detection — waiting for confirmation', { serverAppleId, clientAppleId });
          } else {
            console.warn('[HC_TRACK_DIVERGENCE] confirmed', { serverAppleId, clientAppleId });
            setErrorWithPriority('Player disconnected — tap to reset');
            currentSongIdRef.current = null;
            divergenceSinceRef.current = null;
          }
        } else {
          divergenceSinceRef.current = null; // IDs match — reset cooldown
        }
      } else if (serverNowPlaying && (state === 0 || state === 4 || state === 5)) {
        // Server has a song but player is idle/stopped/ended — may be stuck
        if (!stuckSinceRef.current) {
          stuckSinceRef.current = Date.now();
        } else if (Date.now() - stuckSinceRef.current > 15000) {
          // HC_IDLE_STUCK — fetch first to confirm server still has a song
          // (auto-advance may have already cleared it and we just missed the push)
          console.warn('[HC_IDLE_STUCK] player idle >15s while server has nowPlaying — re-fetching to confirm');
          fetchQueue();
          setErrorWithPriority('Player disconnected — tap to reset');
          currentSongIdRef.current = null;
          stuckSinceRef.current = null;
        }
      } else {
        stuckSinceRef.current = null; // state 1 (loading) or 3 (paused) — not stuck
      }
    }, 12000);
    return () => clearInterval(interval);
  }, [venueCode, fetchQueue, setErrorWithPriority]);

  // ── High-level player controls ───────────────────────────────────────────
  // These are the only methods VenuePlayer needs. Internal refs (musicRef,
  // currentSongIdRef, etc.) are kept private and not exposed in the value.

  // Play/pause — handles all MusicKit state machine branches.
  // IMPORTANT: no beginTransition() call here — setIsTransitioning triggers a
  // React re-render which breaks WebKit's user gesture chain before music.play(),
  // causing "user failed to interact with document first" on Safari/iOS.
  const playPause = useCallback(async () => {
    const music = musicRef.current;
    if (!music) return;
    hasUserGestureRef.current = true;
    const wasWaiting = waitingForGestureRef.current;
    setWaitingForGesture(false);
    const state = music.playbackState;
    const nowPlaying = queueRef.current.nowPlaying;

    if (state === 2) {
      // Currently playing → pause
      await music.pause();
      if (nowPlaying) api.pausePlaying(venueCode, nowPlaying.id).catch(() => {});
    } else if (wasWaiting && nowPlaying) {
      // Autoplay was blocked — this tap is the required user gesture.
      currentSongIdRef.current = nowPlaying.id;
      await playSong(nowPlaying);
    } else if (state === 3) {
      // Paused — if server advanced to a newer song, play that; otherwise resume
      if (nowPlaying && nowPlaying.id !== currentSongIdRef.current) {
        currentSongIdRef.current = nowPlaying.id;
        await playSong(nowPlaying);
      } else {
        try {
          await music.play();
          // Tell server to clear pausedAt and recalibrate startedAt at current position
          if (nowPlaying) {
            api.reportPlaying(venueCode, nowPlaying.id, music.currentPlaybackTime || 0).catch(() => {});
          }
        } catch (err) {
          if (err?.message?.toLowerCase().includes('interact') || err?.name === 'NotAllowedError') {
            setWaitingForGesture(true);
          } else {
            console.error('Play error:', err);
          }
        }
      }
    } else if (state === 0 || state === 4 || state === 5) {
      // Nothing loaded / stopped / ended
      if (nowPlaying) {
        currentSongIdRef.current = nowPlaying.id;
        await playSong(nowPlaying);
      }
    }
  }, [venueCode, playSong]);

  // Skip — optimistic update + concurrent API + playSong, then reconcile.
  const skip = useCallback(async () => {
    if (isTransitioningRef.current) return;
    const music = musicRef.current;
    if (music) { try { await music.stop(); } catch {} }
    beginTransition();
    const currentQueue = queueRef.current;
    const skippedSongId = currentQueue.nowPlaying?.id;
    currentSongIdRef.current = null;

    // Optimistic update: show the next song immediately and start loading it
    // in parallel with the /skip network request so there is no silent gap.
    const optimisticNext = currentQueue.upcoming[0];
    if (optimisticNext) {
      const nextNow = { ...optimisticNext, positionMs: 0, positionAnchoredAt: Date.now(), isPaused: false };
      setQueue({ nowPlaying: nextNow, upcoming: currentQueue.upcoming.slice(1) });
      currentSongIdRef.current = optimisticNext.id;
    }

    // Run the network request and playSong concurrently, then wait for both
    // before ending the transition — ensures endTransition is never called
    // while playSong is still in flight.
    await Promise.allSettled([
      api.skipSong(venueCode, skippedSongId).catch((err) => console.error('Skip error:', err)),
      optimisticNext ? playSong(optimisticNext) : Promise.resolve(),
    ]);
    endTransition();
    await fetchQueue(); // reconcile optimistic state with server reality
  }, [venueCode, playSong, beginTransition, endTransition, fetchQueue]);

  // Restart — rewind current song to position 0.
  const restart = useCallback(async () => {
    const music = musicRef.current;
    const np = queueRef.current.nowPlaying;
    // Guard: seekToTime throws "without a previous descriptor" if no queue is set
    if (!music || !np) return;
    try { await music.seekToTime(0); } catch {}
    api.reportPlaying(venueCode, np.id, 0).catch(() => {});
  }, [venueCode]);

  // Authorize — trigger Apple Music sign-in.
  const authorize = useCallback(async () => {
    const music = musicRef.current;
    if (!music) return;
    try {
      await music.authorize();
      setIsAuthorized(music.isAuthorized);
    } catch (err) { console.error('Auth error:', err); }
  }, []);

  // changeMode — update autoplay mode state + server setting together.
  const changeMode = useCallback(async (mode) => {
    setAutoplayMode(mode);
    autoplayModeRef.current = mode;
    await api.updateSettings(venueCode, {
      autoplayQueue: mode !== 'off',
      autoplayMode: mode,
    }).catch(console.error);
  }, [venueCode]);

  // initAutoplayMode — set state + ref from saved settings without an API call.
  // Use this on initial load; use changeMode() for user-initiated changes.
  const initAutoplayMode = useCallback((mode) => {
    setAutoplayMode(mode);
    autoplayModeRef.current = mode;
  }, []);

  // clearError — dismiss the current error banner.
  const clearError = useCallback(() => setPlayerError(null), []);

  const value = {
    // Queue state
    queue,
    fetchQueue,
    // Playback state (read-only)
    isPlaying,
    playbackTime,
    playbackDuration,
    isAuthorized,
    musicReady,
    waitingForGesture,
    volume,
    setVolume,
    autoplayMode,
    // Banners
    playerError,
    autofillNotice,
    dismissAutofillNotice,
    // Transitions
    isTransitioning,
    // Controls (high-level — internal refs are NOT exposed)
    playPause,
    skip,
    restart,
    authorize,
    changeMode,
    initAutoplayMode,
    clearError,
    retryInit,
    // playSong is still exposed for edge-cases (e.g. future components that
    // need to trigger playback directly), but prefer the high-level controls.
    playSong,
  };

  return (
    <VenuePlaybackContext.Provider value={value}>
      {children}
    </VenuePlaybackContext.Provider>
  );
}
