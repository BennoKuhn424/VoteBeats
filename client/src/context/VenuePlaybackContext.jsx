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
  useEffect(() => { autoplayModeRef.current = autoplayMode; }, [autoplayMode]);

  // ── Initialize MusicKit ──────────────────────────────────────────────────
  useEffect(() => {
    if (!venueCode) return;
    const token = localStorage.getItem('speeldit_token');
    if (!token) return;

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

        music.addEventListener('playbackStateDidChange', () => {
          setIsPlaying(music.playbackState === 2);
        });
        music.addEventListener('playbackTimeDidChange', () => {
          setPlaybackTime(music.currentPlaybackTime || 0);
          setPlaybackDuration(music.currentPlaybackDuration || 0);
        });
      } catch (err) {
        console.error('MusicKit init error:', err);
      }
    }
    init();
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
      }
      isTransitioningRef.current = false;
    }
  }, [venueCode]);

  const tryAutofill = useCallback(async () => {
    if (autoplayModeRef.current === 'off') return false;
    if (Date.now() < autofill404UntilRef.current) return false;
    try {
      await api.autofillQueue(venueCode);
      return true;
    } catch (err) {
      if (err?.response?.status === 404) {
        autofill404UntilRef.current = Date.now() + 60000;
        console.warn('Autofill: venue not found.');
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
      const res = await api.getQueue(venueCode);
      await handleQueueUpdate(res.data);
    } catch (err) {
      // Swallow — axios-retry already attempted 3 times; don't crash the player
      console.warn('Queue fetch failed after retries:', err?.message);
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
        currentSongIdRef.current = null;
        isTransitioningRef.current = true;
        try {
          await api.advanceQueue(venueCode);
          if (autoplayModeRef.current !== 'off') {
            let nextRes = await api.getQueue(venueCode);
            setQueue(nextRes.data);
            let np = nextRes.data?.nowPlaying;

            if (!np) {
              const filled = await tryAutofill();
              if (filled) {
                nextRes = await api.getQueue(venueCode);
                setQueue(nextRes.data);
                np = nextRes.data?.nowPlaying;
              }
            }

            if (np) {
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
  }, [venueCode, tryAutofill]);

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
  };

  return (
    <VenuePlaybackContext.Provider value={value}>
      {children}
    </VenuePlaybackContext.Provider>
  );
}
