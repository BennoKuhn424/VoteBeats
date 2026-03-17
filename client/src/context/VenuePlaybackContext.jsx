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
  const [volume, setVolume] = useState(() => {
    const saved = localStorage.getItem('speeldit_volume');
    return saved !== null ? Number(saved) : 70;
  });

  const musicRef = useRef(null);
  const currentSongIdRef = useRef(null);
  const isTransitioningRef = useRef(false);
  const autoplayModeRef = useRef(autoplayMode);
  const autofill404UntilRef = useRef(0);
  const autofillBackoffRef = useRef(5000); // escalates: 5s → 10s → 20s → 30s
  // True once the user has clicked something on this page — required before
  // any music.play() call to satisfy browser autoplay policy.
  const hasUserGestureRef = useRef(false);
  useEffect(() => { autoplayModeRef.current = autoplayMode; }, [autoplayMode]);

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
          if (!devToken) return;
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
        console.error('MusicKit init error:', err);
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
  }, [venueCode]);

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
      await api.reportPlaying(venueCode, song.id, 0);
    } catch (err) {
      if (err?.message?.toLowerCase().includes('interact') || err?.name === 'NotAllowedError') {
        setWaitingForGesture(true);
      } else {
        console.error('Play error:', err);
        // Clear ref so the next tap triggers a fresh load attempt
        currentSongIdRef.current = null;
      }
      isTransitioningRef.current = false;
    }
  }, [venueCode]);

  const tryAutofill = useCallback(async () => {
    if (autoplayModeRef.current === 'off') return false;
    if (Date.now() < autofill404UntilRef.current) return false;
    try {
      await api.autofillQueue(venueCode);
      autofillBackoffRef.current = 5000; // reset on success
      return true;
    } catch (err) {
      if (err?.response?.status === 404) {
        const backoff = autofillBackoffRef.current;
        autofill404UntilRef.current = Date.now() + backoff;
        console.warn(`Autofill: no songs — backing off ${backoff / 1000}s.`);
        // Escalate: 5s → 10s → 20s → 30s cap
        autofillBackoffRef.current = Math.min(backoff * 2, 30000);
      } else {
        console.error('Autofill error:', err);
      }
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
        isTransitioningRef.current = true;
        currentSongIdRef.current = nowPlaying.id;
        await playSong(nowPlaying);
        isTransitioningRef.current = false;
      }
    }

    if (!nowPlaying && autoplayModeRef.current !== 'off' && !isTransitioningRef.current) {
      const filled = await tryAutofill();
      if (filled) {
        try {
          const r = await api.getQueue(venueCode);
          setQueue(r.data);
          const np = r.data?.nowPlaying;
          if (np && np.id !== currentSongIdRef.current && !isTransitioningRef.current) {
            isTransitioningRef.current = true;
            currentSongIdRef.current = np.id;
            await playSong(np);
            isTransitioningRef.current = false;
          }
        } catch {}
      }
    }
  }, [venueCode, playSong, tryAutofill]);

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

    socket.on('connect', () => {
      // Re-join venue room after any reconnection (iOS resume, network switch)
      joinRoom();
      // Re-fetch so we catch any updates missed during the disconnection window
      setTimeout(fetchQueue, 300);
    });

    socket.on('queue:updated', handleQueueUpdate);

    // Initial fetch
    fetchQueue();

    return () => {
      socket.off('connect');
      socket.off('queue:updated');
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
        isTransitioningRef.current = true;
        try {
          // /advance now runs autofill internally and returns nowPlaying in one
          // round-trip — no follow-up GET /queue or GET /autofill needed.
          const res = await api.advanceQueue(venueCode, endedSongId);
          if (autoplayModeRef.current !== 'off') {
            const np = res.data?.nowPlaying;
            if (np) {
              setQueue((prev) => ({ ...prev, nowPlaying: np }));
              currentSongIdRef.current = np.id;
              await playSong(np);
            }
          }
        } catch {}
        isTransitioningRef.current = false;
      }
    }
    music.addEventListener('playbackStateDidChange', onStateChange);
    return () => music.removeEventListener('playbackStateDidChange', onStateChange);
  }, [venueCode, playSong]);

  const value = {
    queue,
    setQueue,
    fetchQueue,
    isPlaying,
    setIsPlaying,
    setIsAuthorized,
    playbackTime,
    playbackDuration,
    isAuthorized,
    musicReady,
    waitingForGesture,
    setWaitingForGesture,
    volume,
    setVolume,
    autoplayMode,
    setAutoplayMode,
    autoplayModeRef,
    playSong,
    tryAutofill,
    musicRef,
    currentSongIdRef,
    isTransitioningRef,
    hasUserGestureRef,
  };

  return (
    <VenuePlaybackContext.Provider value={value}>
      {children}
    </VenuePlaybackContext.Provider>
  );
}
