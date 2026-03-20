import { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';
import api from '../utils/api';
import socket from '../utils/socket';
import { useVisibilityAwarePolling } from '../hooks/useVisibilityAwarePolling';

// Lower number = higher priority. Soft notices never overwrite hard errors.
const ERROR_PRIORITY = {
  'Could not connect to Apple Music — tap Retry': 1,
  'Player needs attention — tap to reconnect Apple Music': 2,
  'Player disconnected — tap to reset': 3,
  'Something went wrong — tap Play to retry': 4,
  'Playback failed — retrying…': 5,
};

const VenuePlaybackContext = createContext(null);

export function useVenuePlayback() {
  return useContext(VenuePlaybackContext);
}

// ── Player state machine ──────────────────────────────────────────────────────
// Single source of truth for what the player is doing.
// Impossible combinations (e.g. playing + transitioning) cannot be represented.
//
//   notReady         MusicKit not yet initialised
//   idle             Ready; nothing loaded or stopped between songs
//   waitingForGesture Autoplay blocked by browser policy — waiting for a tap
//   transitioning    Loading a new song (skip / advance / auto-transition)
//   playing          Actively playing
//   paused           Paused by user or server
//
// playerError (separate) can appear alongside any state — it is a banner
// notification, not a playback state.
export const PLAYER_STATES = /** @type {const} */ ({
  NOT_READY: 'notReady',
  IDLE: 'idle',
  WAITING: 'waitingForGesture',
  TRANSITIONING: 'transitioning',
  PLAYING: 'playing',
  PAUSED: 'paused',
});

export function VenuePlaybackProvider({ venueCode, children }) {
  // ── Core state ───────────────────────────────────────────────────────────
  const [queue, setQueue] = useState({ nowPlaying: null, upcoming: [] });
  const [playerState, setPlayerState] = useState(PLAYER_STATES.NOT_READY);
  const [playbackTime, setPlaybackTime] = useState(0);
  const [playbackDuration, setPlaybackDuration] = useState(0);
  const [isAuthorized, setIsAuthorized] = useState(false);
  const [autoplayMode, setAutoplayMode] = useState('playlist');
  const [playerError, setPlayerError] = useState(null);
  const [autofillNotice, setAutofillNotice] = useState(false);
  const [initKey, setInitKey] = useState(0); // incremented by retryInit()
  const [volume, setVolume] = useState(() => {
    const parsed = Number(localStorage.getItem('speeldit_volume'));
    return (!isNaN(parsed) && parsed >= 0) ? Math.min(parsed, 100) : 70;
  });

  // ── Refs (internal — not exposed in context value) ───────────────────────
  const musicRef = useRef(null);
  const currentSongIdRef = useRef(null);
  // Synchronous mirror of playerState for guards that cannot wait for a render.
  const playerStateRef = useRef(PLAYER_STATES.NOT_READY);
  const transitionWatchdogRef = useRef(null);
  const autoplayModeRef = useRef(autoplayMode);
  const autofill404UntilRef = useRef(0);
  const autofillBackoffRef = useRef(5000); // escalates 5s→10s→20s→30s
  const playFailCountRef = useRef(0);
  const playLockRef = useRef(false);        // serialises playSong calls
  const queueRef = useRef(queue);           // stable ref for the health-check interval
  const stuckSinceRef = useRef(null);
  const divergenceSinceRef = useRef(null);
  // Tracks when each health-check error was last fired to prevent re-bannering
  // every 12s while the condition persists. Key = error message string.
  const hcLastFiredRef = useRef({});
  const autofillDismissedAtRef = useRef(0);
  // True once the user has clicked anything — required for browser autoplay policy.
  const hasUserGestureRef = useRef(false);

  // ── Sync refs ────────────────────────────────────────────────────────────
  useEffect(() => { autoplayModeRef.current = autoplayMode; }, [autoplayMode]);
  useEffect(() => { queueRef.current = queue; }, [queue]);

  // ── setPlayerState wrapper: keeps ref in sync ─────────────────────────────
  const updatePlayerState = useCallback((next) => {
    playerStateRef.current = next;
    setPlayerState(next);
  }, []);

  // ── Error priority ───────────────────────────────────────────────────────
  const setErrorWithPriority = useCallback((newMsg) => {
    setPlayerError((prev) => {
      if (!newMsg) return null;
      const newP = ERROR_PRIORITY[newMsg] ?? 99;
      const prevP = ERROR_PRIORITY[prev] ?? 99;
      return newP <= prevP ? newMsg : prev;
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Autofill notice ──────────────────────────────────────────────────────
  const dismissAutofillNotice = useCallback(() => {
    autofillDismissedAtRef.current = Date.now();
    setAutofillNotice(false);
  }, []);

  // ── Transition helpers (internal — not in context value) ──────────────────
  // beginTransition / endTransition keep playerStateRef (synchronous guard)
  // and playerState (UI) consistent, with a 10-second watchdog.
  const beginTransition = useCallback(() => {
    updatePlayerState(PLAYER_STATES.TRANSITIONING);
    clearTimeout(transitionWatchdogRef.current);
    transitionWatchdogRef.current = setTimeout(() => {
      if (playerStateRef.current === PLAYER_STATES.TRANSITIONING) {
        console.warn('[PLAYER_WATCHDOG] transition stuck >10 s — forcing reset');
        updatePlayerState(PLAYER_STATES.IDLE);
        setErrorWithPriority('Something went wrong — tap Play to retry');
      }
    }, 10000);
  }, [updatePlayerState, setErrorWithPriority]);

  const endTransition = useCallback(() => {
    clearTimeout(transitionWatchdogRef.current);
    // Resolve to the actual MusicKit state so we don't show 'idle' when playing
    const music = musicRef.current;
    const mk = music?.playbackState;
    const resolved =
      mk === 2 ? PLAYER_STATES.PLAYING :
      mk === 3 ? PLAYER_STATES.PAUSED :
      PLAYER_STATES.IDLE;
    updatePlayerState(resolved);
  }, [updatePlayerState]);

  // ── MusicKit init ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!venueCode) return;
    const token = localStorage.getItem('speeldit_token');
    if (!token) return;

    let stateListener = null;
    let timeListener = null;
    let itemListener = null;
    let authListener = null;
    let onVisibilityForAuth = null;

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
        setPlayerError(null);

        // Ask iOS to treat this tab as playback (music), so audio is less likely to stop when backgrounded (iOS 17+).
        if (typeof navigator !== 'undefined' && navigator.audioSession?.type !== undefined) {
          try { navigator.audioSession.type = 'playback'; } catch (_) {}
        }

        // Sync initial MusicKit state into playerState
        const initialState =
          music.playbackState === 2 ? PLAYER_STATES.PLAYING :
          music.playbackState === 3 ? PLAYER_STATES.PAUSED :
          PLAYER_STATES.IDLE;
        updatePlayerState(initialState);

        setPlaybackTime(music.currentPlaybackTime || 0);
        setPlaybackDuration(music.currentPlaybackDuration || 0);

        // MusicKit state listener — drives playerState when not transitioning.
        stateListener = () => {
          // Don't let MusicKit's internal states (1=loading) override 'transitioning'.
          if (playerStateRef.current === PLAYER_STATES.TRANSITIONING) return;
          // Don't clear 'waitingForGesture' — only user gesture clears that.
          if (playerStateRef.current === PLAYER_STATES.WAITING &&
              music.playbackState !== 2 && music.playbackState !== 3) return;

          const mk = music.playbackState;
          if (mk === 2) updatePlayerState(PLAYER_STATES.PLAYING);
          else if (mk === 3) updatePlayerState(PLAYER_STATES.PAUSED);
          else if (mk === 0 || mk === 4 || mk === 5) {
            updatePlayerState(PLAYER_STATES.IDLE);
            // mk===5: song ended. Skip to next pre-loaded item so playback
            // continues, then tell the server to advance.
            // Guard with playLockRef so we don't race with an active playSong.
            if (mk === 5 && autoplayModeRef.current !== 'off' && !playLockRef.current) {
              const endedId = currentSongIdRef.current;
              const upcoming = queueRef.current?.upcoming || [];
              const nextSong = upcoming.find((s) => s.appleId && s.id !== endedId);
              if (nextSong) {
                currentSongIdRef.current = nextSong.id;
                setQueue((prev) => ({
                  nowPlaying: { ...nextSong, positionMs: 0, positionAnchoredAt: Date.now(), isPaused: false },
                  upcoming: (prev.upcoming || []).slice(1),
                }));
                music.skipToNextItem().catch(() => {
                  currentSongIdRef.current = endedId; // restore on failure
                });
              }
              if (endedId) {
                api.advanceQueue(venueCode, endedId).catch(() => {});
              }
            }
          }
          // mk === 1 (MusicKit loading): ignore, we manage this via 'transitioning'
        };
        timeListener = () => {
          setPlaybackTime(music.currentPlaybackTime || 0);
          setPlaybackDuration(music.currentPlaybackDuration || 0);
        };
        // Detect background auto-advance: MusicKit moved to next pre-loaded item
        // (e.g. while screen was locked). Find which song by appleId and sync state.
        itemListener = () => {
          // Don't interfere while playSong is actively loading a new queue
          if (playLockRef.current) return;
          const newAppleId = String(music.nowPlayingItem?.id || '');
          if (!newAppleId) return;
          const upcoming = queueRef.current?.upcoming ?? [];
          const idx = upcoming.findIndex((s) => String(s?.appleId) === newAppleId);
          if (idx < 0 || currentSongIdRef.current === upcoming[idx]?.id) return;
          const nextSong = upcoming[idx];
          const endedSongId = currentSongIdRef.current;
          currentSongIdRef.current = nextSong.id;
          setQueue((prev) => ({
            nowPlaying: { ...nextSong, positionMs: 0, positionAnchoredAt: Date.now(), isPaused: false },
            upcoming: [...(prev.upcoming || []).slice(0, idx), ...(prev.upcoming || []).slice(idx + 1)],
          }));
          api.advanceQueue(venueCode, endedSongId).catch((e) =>
            console.warn('[BG_ADVANCE] server sync failed:', e?.message));
        };

        // Re-sync isAuthorized whenever Apple Music auth state changes.
        // On iOS the user is sent to the Apple Music app to approve — when they
        // switch back to the browser this event fires and the UI updates without
        // requiring a manual page reload.
        authListener = () => { setIsAuthorized(music.isAuthorized); };
        music.addEventListener('authorizationStatusDidChange', authListener);

        // Fallback: re-check on tab focus in case the event fires before the
        // page is visible (e.g. iOS redirecting through Safari and back).
        onVisibilityForAuth = () => {
          if (!document.hidden) setIsAuthorized(music.isAuthorized);
        };
        document.addEventListener('visibilitychange', onVisibilityForAuth);

        music.addEventListener('playbackStateDidChange', stateListener);
        music.addEventListener('playbackTimeDidChange', timeListener);
        music.addEventListener('nowPlayingItemDidChange', itemListener);
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
        if (itemListener) music.removeEventListener('nowPlayingItemDidChange', itemListener);
        if (authListener) music.removeEventListener('authorizationStatusDidChange', authListener);
      }
      if (onVisibilityForAuth) document.removeEventListener('visibilitychange', onVisibilityForAuth);
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

  // ── playSong ─────────────────────────────────────────────────────────────
  const playSong = useCallback(async (song) => {
    const music = musicRef.current;
    if (!music || !song?.appleId) return;
    // Don't attempt playback when offline — it will fail and trigger error cascades.
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
    // Serialise: only one playSong at a time. Prevents the MusicKit
    // "play() called without a previous stop()/pause()" crash.
    if (playLockRef.current) return;
    playLockRef.current = true;
    try {
      if (!music.isAuthorized) {
        await music.authorize();
        setIsAuthorized(music.isAuthorized);
      }
      // Fully stop MusicKit before loading a new queue.
      // Order matters: stop() first clears the playback pipeline,
      // then pause() ensures no lingering "playing" state that causes
      // the "play() called without a previous stop()/pause()" crash.
      const mk = music.playbackState;
      if (mk === 2 || mk === 1) { // playing or loading
        try { await music.stop(); } catch {}
      } else if (mk === 3) { // paused
        try { await music.stop(); } catch {}
      }
      // Small delay lets MusicKit settle its internal state machine
      await new Promise((r) => setTimeout(r, 100));

      // Pre-load multiple upcoming songs so MusicKit can auto-advance natively
      // when the screen is locked — iOS can transition at the OS level without
      // JavaScript running at each song end. More items = more tracks play through lock.
      const upcoming = queueRef.current?.upcoming ?? [];
      const others = upcoming.filter((s) => s.appleId && s.id !== song.id);
      const LOCK_SCREEN_QUEUE_SIZE = 10; // current + 9 more; ~30-40 min of lock-screen playback
      const ids = [song.appleId, ...others.slice(0, LOCK_SCREEN_QUEUE_SIZE - 1)].filter(Boolean);
      await music.setQueue({ songs: ids });
      await music.play();
      // MusicKit listener will set PLAYING; clear any error on success
      setPlayerError(null);
      playFailCountRef.current = 0;
      api.reportPlaying(venueCode, song.id, 0).catch(() => {});
    } catch (err) {
      if (err?.message?.toLowerCase().includes('interact') || err?.name === 'NotAllowedError') {
        updatePlayerState(PLAYER_STATES.WAITING);
      } else {
        console.error('Play error:', err);
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
        // Safety: don't leave player stuck in 'transitioning'
        if (playerStateRef.current === PLAYER_STATES.TRANSITIONING) {
          endTransition();
        }
      }
    } finally {
      playLockRef.current = false;
    }
  }, [venueCode, endTransition, updatePlayerState, setErrorWithPriority]);

  // ── tryAutofill ──────────────────────────────────────────────────────────
  const tryAutofill = useCallback(async () => {
    if (autoplayModeRef.current === 'off') return false;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return false;
    if (Date.now() < autofill404UntilRef.current) return false;
    try {
      const res = await api.autofillQueue(venueCode);
      if (res.data?.filled === false) {
        const backoff = autofillBackoffRef.current;
        autofill404UntilRef.current = Date.now() + backoff;
        console.warn(`Autofill: no songs — backing off ${backoff / 1000}s.`);
        autofillBackoffRef.current = Math.min(backoff * 2, 30000);
        const NOTICE_COOLDOWN_MS = 5 * 60 * 1000;
        if (Date.now() - autofillDismissedAtRef.current > NOTICE_COOLDOWN_MS) {
          setAutofillNotice(true);
        }
        return false;
      }
      autofillBackoffRef.current = 5000;
      setAutofillNotice(false);
      return true;
    } catch (err) {
      console.error('Autofill error:', err);
      return false;
    }
  }, [venueCode]);

  // ── handleQueueUpdate ────────────────────────────────────────────────────
  const handleQueueUpdate = useCallback(async (newQueue) => {
    setQueue(newQueue);
    const nowPlaying = newQueue.nowPlaying;

    // Don't interfere if a playSong is already in flight
    if (playLockRef.current) return;

    if (nowPlaying && nowPlaying.id !== currentSongIdRef.current &&
        playerStateRef.current !== PLAYER_STATES.TRANSITIONING) {
      // Check if MusicKit is already playing this track (e.g. from pre-loaded queue)
      const currentAppleId = musicRef.current?.nowPlayingItem?.id;
      if (currentAppleId && String(currentAppleId) === String(nowPlaying.appleId)) {
        currentSongIdRef.current = nowPlaying.id;
      } else if (musicRef.current?.playbackState === 3) {
        // Paused — don't force a new song
      } else if (!hasUserGestureRef.current) {
        updatePlayerState(PLAYER_STATES.WAITING);
      } else {
        beginTransition();
        currentSongIdRef.current = nowPlaying.id;
        await playSong(nowPlaying);
        endTransition();
      }
    }

    if (!nowPlaying && autoplayModeRef.current !== 'off' &&
        playerStateRef.current !== PLAYER_STATES.TRANSITIONING &&
        !playLockRef.current) {
      const filled = await tryAutofill();
      if (filled) {
        try {
          const r = await api.getQueue(venueCode);
          const np = r.data?.nowPlaying;
          setQueue(r.data);
          if (np?.appleId && np.id !== currentSongIdRef.current &&
              playerStateRef.current !== PLAYER_STATES.TRANSITIONING &&
              !playLockRef.current) {
            beginTransition();
            currentSongIdRef.current = np.id;
            await playSong(np);
            endTransition();
          }
        } catch {}
      }
    }
  }, [venueCode, playSong, tryAutofill, beginTransition, endTransition, updatePlayerState]);

  // ── fetchQueue ───────────────────────────────────────────────────────────
  const fetchQueue = useCallback(async () => {
    if (!venueCode) return;
    // Skip fetch when offline — the 'online' event will trigger a re-fetch.
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
    try {
      const res = await api.getQueue(venueCode, undefined, { timeout: 5000, 'axios-retry': { retries: 1 } });
      await handleQueueUpdate(res.data);
    } catch (err) {
      console.warn('Queue fetch failed:', err?.message);
    }
  }, [venueCode, handleQueueUpdate]);

  // ── Socket.IO ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!venueCode) return;

    function joinRoom() { socket.emit('join', venueCode); }
    socket.connect();
    joinRoom();

    function onConnect() {
      joinRoom();
      setTimeout(fetchQueue, 300);
    }
    socket.on('connect', onConnect);
    socket.on('queue:updated', handleQueueUpdate);
    fetchQueue();

    return () => {
      socket.off('connect', onConnect);
      socket.off('queue:updated', handleQueueUpdate);
      socket.disconnect();
    };
  }, [venueCode, fetchQueue, handleQueueUpdate]);

  // ── Visibility-aware fallback poll ───────────────────────────────────────
  useVisibilityAwarePolling(fetchQueue, 15000);

  // ── Network recovery: reset error state when coming back online ─────────
  useEffect(() => {
    function onOnline() {
      playFailCountRef.current = 0;
      setPlayerError(null);
      hcLastFiredRef.current = {};
      stuckSinceRef.current = null;
      divergenceSinceRef.current = null;
    }
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, []);

  // ── Auto-clear autofill notice when a song starts ────────────────────────
  useEffect(() => {
    if (queue.nowPlaying) setAutofillNotice(false);
  }, [queue.nowPlaying]);

  // ── Health check ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!venueCode) return;

    // Only fire the same error banner once per cooldown window (60s).
    // Prevents re-showing the same banner every 12s while a fault persists.
    const HC_BANNER_COOLDOWN_MS = 60_000;
    function hcSetError(msg) {
      const now = Date.now();
      if (now - (hcLastFiredRef.current[msg] ?? 0) < HC_BANNER_COOLDOWN_MS) return;
      hcLastFiredRef.current[msg] = now;
      setErrorWithPriority(msg);
    }

    const interval = setInterval(() => {
      const music = musicRef.current;
      if (!music) return;
      // Skip health check when offline — network errors are expected,
      // recovery will happen via the 'online' event and visibility handler.
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        stuckSinceRef.current = null;
        divergenceSinceRef.current = null;
        return;
      }
      const serverNowPlaying = queueRef.current?.nowPlaying;
      const mk = music.playbackState;

      if (mk === 2) {
        stuckSinceRef.current = null;
        const serverAppleId = String(serverNowPlaying?.appleId || '');
        const clientAppleId = String(music.nowPlayingItem?.id || '');
        if (serverAppleId && clientAppleId && serverAppleId !== clientAppleId) {
          if (!divergenceSinceRef.current) {
            divergenceSinceRef.current = Date.now();
            console.warn('[HC_TRACK_DIVERGENCE] first detection', { serverAppleId, clientAppleId });
          } else {
            console.warn('[HC_TRACK_DIVERGENCE] confirmed', { serverAppleId, clientAppleId });
            hcSetError('Player disconnected — tap to reset');
            currentSongIdRef.current = null;
            divergenceSinceRef.current = null;
          }
        } else {
          divergenceSinceRef.current = null;
        }
      } else if (serverNowPlaying && (mk === 0 || mk === 4 || mk === 5)) {
        if (!stuckSinceRef.current) {
          stuckSinceRef.current = Date.now();
        } else if (Date.now() - stuckSinceRef.current > 15000) {
          console.warn('[HC_IDLE_STUCK] player idle >15s while server has nowPlaying');
          fetchQueue();
          hcSetError('Player disconnected — tap to reset');
          currentSongIdRef.current = null;
          stuckSinceRef.current = null;
        }
      } else {
        stuckSinceRef.current = null;
      }
    }, 12000);
    return () => clearInterval(interval);
  }, [venueCode, fetchQueue, setErrorWithPriority]);

  // ── High-level player controls ───────────────────────────────────────────

  // playPause: handles all MusicKit state branches.
  // No beginTransition() here — setPlayerState('transitioning') would trigger a
  // React re-render that breaks WebKit's user gesture chain before music.play().
  const playPause = useCallback(async () => {
    const music = musicRef.current;
    if (!music) return;
    hasUserGestureRef.current = true;
    const wasWaiting = playerStateRef.current === PLAYER_STATES.WAITING;
    const nowPlaying = queueRef.current.nowPlaying;
    const mk = music.playbackState;

    if (mk === 2) {
      // Playing → pause
      await music.pause();
      if (nowPlaying) api.pausePlaying(venueCode, nowPlaying.id).catch(() => {});
    } else if (wasWaiting && nowPlaying) {
      // Unblock autoplay — this tap satisfies browser gesture requirement
      currentSongIdRef.current = nowPlaying.id;
      await playSong(nowPlaying);
    } else if (mk === 3) {
      // Paused — play server's current song or resume
      if (nowPlaying && nowPlaying.id !== currentSongIdRef.current) {
        currentSongIdRef.current = nowPlaying.id;
        await playSong(nowPlaying);
      } else {
        try {
          await music.play();
          if (nowPlaying) {
            api.reportPlaying(venueCode, nowPlaying.id, music.currentPlaybackTime || 0).catch(() => {});
          }
        } catch (err) {
          if (err?.message?.toLowerCase().includes('interact') || err?.name === 'NotAllowedError') {
            updatePlayerState(PLAYER_STATES.WAITING);
          } else {
            console.error('Play error:', err);
          }
        }
      }
    } else if (mk === 0 || mk === 4 || mk === 5) {
      // Nothing loaded / stopped / ended
      if (nowPlaying) {
        currentSongIdRef.current = nowPlaying.id;
        await playSong(nowPlaying);
      }
    }
  }, [venueCode, playSong, updatePlayerState]);

  // skip: optimistic update + concurrent API + playSong, then reconcile.
  const skip = useCallback(async () => {
    if (playerStateRef.current === PLAYER_STATES.TRANSITIONING) return;
    if (playLockRef.current) return; // don't skip while a song is loading
    const music = musicRef.current;
    if (music) { try { await music.stop(); } catch {} }
    beginTransition();
    const currentQueue = queueRef.current;
    const skippedSongId = currentQueue.nowPlaying?.id;

    const optimisticNext = currentQueue.upcoming[0];
    if (optimisticNext) {
      const nextNow = { ...optimisticNext, positionMs: 0, positionAnchoredAt: Date.now(), isPaused: false };
      setQueue({ nowPlaying: nextNow, upcoming: currentQueue.upcoming.slice(1) });
      // Set currentSongIdRef BEFORE playSong so handleQueueUpdate won't
      // see a mismatch and try to play the same song again.
      currentSongIdRef.current = optimisticNext.id;
    } else {
      currentSongIdRef.current = null;
    }

    // Run server skip and playSong concurrently
    await Promise.allSettled([
      api.skipSong(venueCode, skippedSongId).catch((err) => console.error('Skip error:', err)),
      optimisticNext ? playSong(optimisticNext) : Promise.resolve(),
    ]);
    endTransition();

    // Reconcile with server — but DON'T re-trigger playSong for the song
    // we just started (handleQueueUpdate checks currentSongIdRef).
    fetchQueue().catch(() => {});
  }, [venueCode, playSong, beginTransition, endTransition, fetchQueue]);

  // restart: rewind current song to position 0.
  const restart = useCallback(async () => {
    const music = musicRef.current;
    const np = queueRef.current.nowPlaying;
    if (!music || !np) return;
    try { await music.seekToTime(0); } catch {}
    api.reportPlaying(venueCode, np.id, 0).catch(() => {});
  }, [venueCode]);

  // authorize: trigger Apple Music sign-in.
  const authorize = useCallback(async () => {
    const music = musicRef.current;
    if (!music) return;
    try {
      await music.authorize();
      setIsAuthorized(music.isAuthorized);
    } catch (err) { console.error('Auth error:', err); }
  }, []);

  // changeMode: update autoplay mode state + server setting.
  const changeMode = useCallback(async (mode) => {
    setAutoplayMode(mode);
    autoplayModeRef.current = mode;
    await api.updateSettings(venueCode, {
      autoplayQueue: mode !== 'off',
      autoplayMode: mode,
    }).catch(console.error);
  }, [venueCode]);

  // initAutoplayMode: set state from saved settings — no API call.
  const initAutoplayMode = useCallback((mode) => {
    setAutoplayMode(mode);
    autoplayModeRef.current = mode;
  }, []);

  // clearError: dismiss the error banner and reset the HC cooldown so a
  // subsequent real fault can re-appear immediately after a manual dismiss.
  const clearError = useCallback(() => {
    hcLastFiredRef.current = {};
    setPlayerError(null);
  }, []);

  // ── Media Session API: lock screen / Control Center show correct track and controls ──
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;
    const np = queue.nowPlaying;
    const isPlaying = playerState === PLAYER_STATES.PLAYING;
    const isPaused = playerState === PLAYER_STATES.PAUSED;
    navigator.mediaSession.playbackState = isPlaying ? 'playing' : isPaused ? 'paused' : 'none';
    if (np) {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: np.title || 'Speeldit',
        artist: np.artist || '',
        album: '',
        artwork: np.albumArt
          ? [{ src: np.albumArt, sizes: '512x512', type: 'image/jpeg' }]
          : [],
      });
      if (isPlaying && playbackDuration > 0 && 'setPositionState' in navigator.mediaSession) {
        try {
          navigator.mediaSession.setPositionState({
            duration: playbackDuration,
            position: playbackTime,
            playbackRate: 1,
          });
        } catch (_) {}
      } else if ('setPositionState' in navigator.mediaSession) {
        try { navigator.mediaSession.setPositionState(null); } catch (_) {}
      }
    }
  }, [queue.nowPlaying, playerState, playbackTime, playbackDuration]);

  // Media Session action handlers so lock screen play/pause/next work.
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;
    const handlers = [
      ['play', () => { playPause(); }],
      ['pause', () => { playPause(); }],
      ['previoustrack', () => { restart(); }],
      ['nexttrack', () => { skip(); }],
    ];
    for (const [action, handler] of handlers) {
      try { navigator.mediaSession.setActionHandler(action, handler); } catch (_) {}
    }
    return () => {
      for (const [action] of handlers) {
        try { navigator.mediaSession.setActionHandler(action, null); } catch (_) {}
      }
    };
  }, [playPause, skip, restart]);

  const value = {
    // Player state (single source of truth — replaces isPlaying, isTransitioning,
    // waitingForGesture, musicReady)
    playerState,
    // Queue
    queue,
    fetchQueue,
    // Audio metrics
    playbackTime,
    playbackDuration,
    isAuthorized,
    volume,
    setVolume,
    autoplayMode,
    // Banners
    playerError,
    autofillNotice,
    dismissAutofillNotice,
    // Controls (all MusicKit internals are private)
    playPause,
    skip,
    restart,
    authorize,
    changeMode,
    initAutoplayMode,
    clearError,
    retryInit,
  };

  return (
    <VenuePlaybackContext.Provider value={value}>
      {children}
    </VenuePlaybackContext.Provider>
  );
}
