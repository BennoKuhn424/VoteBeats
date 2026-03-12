import { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';
import api from '../utils/api';

const VenuePlaybackContext = createContext(null);

export function useVenuePlayback() {
  const ctx = useContext(VenuePlaybackContext);
  return ctx;
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
  const autofill404UntilRef = useRef(0); // Back off autofill after 404 (venue not found)
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
      if (!music.isAuthorized) await music.authorize();
      setIsAuthorized(music.isAuthorized);
      try { await music.stop(); } catch {}
      await music.setQueue({ songs: [song.appleId] });
      await music.play();
      setWaitingForGesture(false);
      await api.reportPlaying(venueCode, song.id);
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
        console.warn('Autofill: venue not found. If you just deployed, register again on this server.');
      } else {
        console.error('Autofill error:', err);
      }
      return false;
    }
  }, [venueCode]);

  const fetchQueue = useCallback(async () => {
    if (!venueCode) return;
    try {
      const res = await api.getQueue(venueCode);
      const newQueue = res.data;
      setQueue(newQueue);
      const nowPlaying = newQueue.nowPlaying;

      if (nowPlaying && nowPlaying.id !== currentSongIdRef.current && !isTransitioningRef.current) {
        const currentAppleId = musicRef.current?.nowPlayingItem?.id;
        if (currentAppleId && String(currentAppleId) === String(nowPlaying.appleId)) {
          currentSongIdRef.current = nowPlaying.id;
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
          // Immediately pick up the autofilled song — don't wait 2s for the next poll
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
    } catch (err) {
      console.error('Queue poll error:', err);
    }
  }, [venueCode, playSong, tryAutofill]);

  useEffect(() => {
    if (!venueCode) return;
    fetchQueue();
    const interval = setInterval(fetchQueue, 2000);
    return () => clearInterval(interval);
  }, [venueCode, fetchQueue]);

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
            // Fetch queue immediately after advance — upcoming[0] may already be nowPlaying
            let nextRes = await api.getQueue(venueCode);
            setQueue(nextRes.data);
            let np = nextRes.data?.nowPlaying;

            // Queue was empty after advance — try autofill to get the next song
            if (!np) {
              const filled = await tryAutofill();
              if (filled) {
                nextRes = await api.getQueue(venueCode);
                setQueue(nextRes.data);
                np = nextRes.data?.nowPlaying;
              }
            }

            // Play immediately — no isTransitioningRef guard needed, we own this transition
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
