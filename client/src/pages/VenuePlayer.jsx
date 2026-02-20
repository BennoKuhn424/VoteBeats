import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Music2,
  LogOut,
  SkipBack,
  Play,
  Pause,
  SkipForward,
  Volume2,
} from 'lucide-react';
import api from '../utils/api';
import Button from '../components/shared/Button';
import { initMusicKit, getMusicInstance, unauthorizeMusicKit } from '../utils/musickit';

const POLL_INTERVAL = 5000;

export default function VenuePlayer() {
  const { venueCode } = useParams();
  const navigate = useNavigate();
  const [queue, setQueue] = useState({ nowPlaying: null, upcoming: [] });
  const [isAuthorized, setIsAuthorized] = useState(false);
  const [autoplay, setAutoplay] = useState(true);
  const [musicReady, setMusicReady] = useState(false);
  const [error, setError] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [volume, setVolume] = useState(70);
  const lastPlayedIdRef = useRef(null);
  const playbackListenerRef = useRef(null);
  const autoplayFromServerRef = useRef(false);
  const startPlaybackWithQueueRef = useRef(null);
  const [playbackBlocked, setPlaybackBlocked] = useState(false);
  const [previewDetected, setPreviewDetected] = useState(false);
  const playbackStartedAtRef = useRef(null);
  const expectedDurationRef = useRef(null);

  useEffect(() => {
    let mounted = true;
    async function setup() {
      const music = await initMusicKit();
      if (!mounted || !music) return;
      setMusicReady(true);
      setIsAuthorized(music.isAuthorized);
    }
    setup();
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    if (!venueCode) return;
    async function load() {
      try {
        const res = await api.getQueue(venueCode);
        const serverNowId = res.data?.nowPlaying?.appleId ? String(res.data.nowPlaying.appleId) : null;
        const lastId = lastPlayedIdRef.current ? String(lastPlayedIdRef.current) : null;
        if (serverNowId && lastId && lastId !== serverNowId && getMusicInstance()?.isAuthorized) {
          startPlaybackWithQueueRef.current?.(res.data);
        }
        setQueue(res.data);
        if (!autoplayFromServerRef.current) {
          const fromServer = res.data?.requestSettings?.autoplayQueue;
          if (fromServer !== undefined) {
            setAutoplay(fromServer);
            autoplayFromServerRef.current = true;
          }
        }
        setError(null);
      } catch (err) {
        setError('Could not load queue');
      }
    }
    load();
    const interval = setInterval(load, POLL_INTERVAL);
    return () => clearInterval(interval);
  }, [venueCode]);

  const startPlaybackWithQueue = useCallback((queueData) => {
    const music = getMusicInstance();
    if (!music || !music.isAuthorized) return;
    const q = queueData || queue;
    const ids = [];
    if (q?.nowPlaying?.appleId) ids.push(String(q.nowPlaying.appleId));
    (q?.upcoming || []).forEach((s) => { if (s?.appleId) ids.push(String(s.appleId)); });
    if (ids.length === 0) return;

    const opts = ids.length > 1 ? { songs: ids, startPlaying: true } : { song: ids[0], startPlaying: true };
    const expectedSec = (queueData || queue)?.nowPlaying?.duration ? Number((queueData || queue).nowPlaying.duration) : 0;
    expectedDurationRef.current = expectedSec;

    music.setQueue(opts).then(() => {
      playbackStartedAtRef.current = Date.now();
      lastPlayedIdRef.current = ids[0];
      setPlaybackBlocked(false);
      setIsPlaying(true);
      if (venueCode && ids[0]) api.reportPlaying(venueCode, ids[0]).catch(() => {});
    }).catch((err) => {
      if (ids.length > 1) {
        music.setQueue({ song: ids[0] }).then(() => music.play()).then(() => {
          playbackStartedAtRef.current = Date.now();
          expectedDurationRef.current = (queueData || queue)?.nowPlaying?.duration ? Number((queueData || queue).nowPlaying.duration) : 0;
          lastPlayedIdRef.current = ids[0];
          setPlaybackBlocked(false);
          setIsPlaying(true);
          if (venueCode && ids[0]) api.reportPlaying(venueCode, ids[0]).catch(() => {});
        }).catch((e) => {
          console.error('Playback error:', e);
          setPlaybackBlocked(true);
        });
      } else {
        console.error('Playback error:', err);
        setPlaybackBlocked(true);
      }
    });
  }, [venueCode, queue?.nowPlaying?.appleId, queue?.upcoming]);

  startPlaybackWithQueueRef.current = startPlaybackWithQueue;
  const startPlayback = useCallback(() => startPlaybackWithQueue(null), [startPlaybackWithQueue]);

  const handleSkip = useCallback(async () => {
    try {
      await api.advanceQueue(venueCode);
      const res = await api.getQueue(venueCode);
      setQueue(res.data);
      const music = getMusicInstance();
      if (music?.isAuthorized && (res.data?.nowPlaying || res.data?.upcoming?.length > 0)) {
        startPlaybackWithQueue(res.data);
      }
    } catch (_) {}
  }, [venueCode, startPlaybackWithQueue]);

  const handlePlaybackCompleted = useCallback(async () => {
    const expectedSec = expectedDurationRef.current || 0;
    const playedMs = playbackStartedAtRef.current ? Date.now() - playbackStartedAtRef.current : 0;
    const playedSec = playedMs / 1000;
    if (expectedSec > 60 && playedSec > 0 && playedSec < 45) setPreviewDetected(true);
    playbackStartedAtRef.current = null;
    expectedDurationRef.current = null;
    lastPlayedIdRef.current = null;
    setIsPlaying(false);
    await api.advanceQueue(venueCode).catch(() => {});

    if (autoplayRef.current) {
      const music = getMusicInstance();
      let continued = false;
      try {
        if (typeof music?.skipToNextItem === 'function') {
          await music.skipToNextItem();
          await music.play();
          playbackStartedAtRef.current = Date.now();
          setIsPlaying(true);
          continued = true;
        }
      } catch (_) {}

      if (!continued) {
        try {
          const res = await api.getQueue(venueCode);
          const q = res.data;
          const hasMore = q?.nowPlaying?.appleId || (q?.upcoming?.length ?? 0) > 0;
          if (hasMore) {
            setQueue(q);
            startPlaybackWithQueue(q);
          }
        } catch (_) {}
      } else {
        try {
          const res = await api.getQueue(venueCode);
          setQueue(res.data);
          if (res.data?.nowPlaying?.appleId) lastPlayedIdRef.current = String(res.data.nowPlaying.appleId);
        } catch (_) {}
      }
    }
  }, [venueCode, startPlaybackWithQueue]);

  const autoplayRef = useRef(autoplay);
  autoplayRef.current = autoplay;

  useEffect(() => {
    const music = getMusicInstance();
    if (!music || !music.isAuthorized || !venueCode) return;
    const handler = (e) => {
      if (e.state === 'completed') handlePlaybackCompleted();
      else if (e.state === 'playing') setIsPlaying(true);
      else if (e.state === 'paused' || e.state === 'stopped') setIsPlaying(false);
    };
    playbackListenerRef.current = handler;
    music.addEventListener('playbackStateDidChange', handler);
    return () => music.removeEventListener('playbackStateDidChange', playbackListenerRef.current);
  }, [isAuthorized, venueCode, handlePlaybackCompleted]);

  const togglePlayPause = useCallback(() => {
    const music = getMusicInstance();
    if (!music?.isAuthorized) return;
    if (isPlaying) {
      music.pause();
      setIsPlaying(false);
    } else {
      if (queue?.nowPlaying || queue?.upcoming?.length > 0) {
        startPlayback();
      } else {
        music.play().then(() => setIsPlaying(true)).catch(() => {});
      }
    }
  }, [isPlaying, queue?.nowPlaying, queue?.upcoming?.length, startPlayback]);

  const handlePrev = useCallback(() => {
    const music = getMusicInstance();
    if (music?.skipToPreviousItem) {
      music.skipToPreviousItem().catch(() => {});
    }
  }, []);

  useEffect(() => {
    const music = getMusicInstance();
    if (!music) return;
    try {
      music.volume = volume / 100;
    } catch (_) {}
  }, [volume]);

  async function handleAuthorize() {
    const music = getMusicInstance();
    if (!music) {
      setError('MusicKit not loaded. Check Apple Music configuration.');
      return;
    }
    try {
      await music.authorize();
      setIsAuthorized(music.isAuthorized);
    } catch (err) {
      setError(err.message || 'Authorization failed');
    }
  }

  if (!venueCode) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-zinc-50 to-zinc-100 flex items-center justify-center p-6">
        <p className="text-zinc-600">Missing venue code. Use /venue/player/YOUR_VENUE_CODE</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-zinc-50 to-zinc-100 pb-safe">
      {/* Header */}
      <header className="bg-white border-b border-zinc-200">
        <div className="max-w-md mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={() => navigate('/venue/dashboard')}
              className="text-zinc-600 hover:text-zinc-900 text-sm font-medium flex items-center gap-1"
            >
              ← Back
            </button>
            <div className="flex items-center gap-2">
              <Music2 className="h-6 w-6 text-brand-600" />
              <h1 className="text-lg font-semibold text-zinc-900">Venue Player</h1>
            </div>
            <button
              type="button"
              onClick={async () => {
                await unauthorizeMusicKit().catch(() => {});
                setIsAuthorized(false);
              }}
              className="text-sm text-zinc-600 hover:text-zinc-900 flex items-center gap-1"
            >
              <LogOut className="h-4 w-4" />
              Sign out
            </button>
          </div>
          <p className="text-zinc-500 text-sm font-mono mt-1">Code: {venueCode}</p>
        </div>
      </header>

      <main className="max-w-md mx-auto px-4 py-6">
        {error && (
          <p className="mb-4 text-amber-600 text-sm bg-amber-50 border border-amber-200 rounded-lg px-4 py-2">
            {error}
          </p>
        )}

        {!musicReady ? (
          <p className="text-zinc-500 text-sm">Loading MusicKit...</p>
        ) : !isAuthorized ? (
          <div className="rounded-2xl border-2 border-amber-300 bg-white p-8 text-center shadow-sm">
            <p className="text-amber-600 font-semibold text-lg mb-2">Login required</p>
            <p className="text-zinc-600 text-sm mb-6">
              Sign in with Apple Music so songs play fully. Use an account with an active Apple Music subscription.
            </p>
            <Button onClick={handleAuthorize} className="w-full !py-4 !text-base font-bold !bg-brand-600 hover:!bg-brand-500">
              Sign in with Apple Music
            </Button>
          </div>
        ) : (
          <>
            {previewDetected && (
              <div className="mb-4 p-4 rounded-xl bg-red-50 border-2 border-red-200 text-red-700 text-sm">
                <p className="font-semibold">Songs stopped early</p>
                <p className="mt-1">Playback cut at ~30 seconds. Add your site URL in Apple Developer → Services IDs.</p>
              </div>
            )}

            {/* Autoplay toggle */}
            <div className="mb-6 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  role="switch"
                  aria-checked={autoplay}
                  onClick={() => setAutoplay(!autoplay)}
                  className={`relative inline-flex h-6 w-11 shrink-0 rounded-full border-2 border-transparent transition-colors ${
                    autoplay ? 'bg-brand-500' : 'bg-zinc-200'
                  }`}
                >
                  <span
                    className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow transition ${
                      autoplay ? 'translate-x-5' : 'translate-x-1'
                    }`}
                  />
                </button>
                <span className="text-sm font-medium text-zinc-700">Autoplay queue</span>
                {autoplay && <span className="text-sm font-medium text-brand-600">Active</span>}
              </div>
            </div>

            {/* Now Playing card */}
            <div className={`bg-white rounded-2xl border border-zinc-200 shadow-sm p-6 mb-6 ${!isAuthorized ? 'opacity-50 pointer-events-none' : ''}`}>
              <h2 className="text-sm font-semibold text-zinc-600 uppercase tracking-wide mb-4">Now Playing</h2>
              {queue.nowPlaying ? (
                <div className="flex items-center gap-4 mb-6">
                  <img
                    src={queue.nowPlaying.albumArt}
                    alt={queue.nowPlaying.title}
                    className="w-20 h-20 rounded-xl object-cover shrink-0"
                  />
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-zinc-900 truncate">{queue.nowPlaying.title}</p>
                    <p className="text-sm text-zinc-500 truncate">{queue.nowPlaying.artist}</p>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-8 mb-4">
                  <Music2 className="h-24 w-24 text-zinc-300 mb-3" />
                  <p className="text-zinc-900 font-medium">No song playing</p>
                  <p className="text-sm text-zinc-500 mt-1">Tap Play once – queue plays automatically</p>
                </div>
              )}

              {playbackBlocked && (queue?.nowPlaying || queue?.upcoming?.length) && (
                <button
                  type="button"
                  onClick={startPlayback}
                  className="mb-4 w-full py-3 px-4 rounded-xl bg-amber-100 border-2 border-amber-400 text-amber-800 font-bold text-center hover:bg-amber-200"
                >
                  Tap to start playback
                </button>
              )}

              {/* Playback controls */}
              <div className="flex items-center justify-center gap-4 mb-6">
                <button
                  type="button"
                  onClick={handlePrev}
                  className="w-12 h-12 rounded-full bg-zinc-100 hover:bg-zinc-200 flex items-center justify-center text-zinc-600"
                >
                  <SkipBack className="h-5 w-5" />
                </button>
                <button
                  type="button"
                  onClick={togglePlayPause}
                  className="w-16 h-16 rounded-full bg-brand-500 hover:bg-brand-400 flex items-center justify-center text-white shadow-lg"
                >
                  {isPlaying ? <Pause className="h-8 w-8" /> : <Play className="h-8 w-8 ml-0.5" />}
                </button>
                <button
                  type="button"
                  onClick={handleSkip}
                  className="w-12 h-12 rounded-full bg-zinc-100 hover:bg-zinc-200 flex items-center justify-center text-zinc-600"
                >
                  <SkipForward className="h-5 w-5" />
                </button>
              </div>

              {/* Volume */}
              <div className="flex items-center gap-3">
                <Volume2 className="h-5 w-5 text-zinc-500 shrink-0" />
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={volume}
                  onChange={(e) => setVolume(Number(e.target.value))}
                  className="flex-1 h-2 bg-zinc-200 rounded-lg appearance-none cursor-pointer accent-brand-500"
                />
                <span className="text-sm text-zinc-500 w-10">{volume}%</span>
              </div>
            </div>

            {/* Upcoming */}
            <div className="bg-white rounded-2xl border border-zinc-200 shadow-sm p-6">
              <h3 className="text-sm font-semibold text-zinc-600 uppercase tracking-wide mb-3">Upcoming</h3>
              {queue.upcoming?.length > 0 ? (
                <div className="space-y-2 max-h-48 overflow-y-auto">
                  {queue.upcoming.slice(0, 8).map((s, i) => (
                    <div key={s.id} className="flex items-center gap-3 p-3 bg-zinc-50 rounded-xl">
                      <span className="text-zinc-500 font-medium text-sm w-5">{i + 1}</span>
                      <img src={s.albumArt} alt="" className="w-10 h-10 rounded-lg object-cover" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-zinc-900 truncate">{s.title}</p>
                        <p className="text-xs text-zinc-500 truncate">{s.artist}</p>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="py-6 text-center">
                  <p className="text-zinc-900 font-medium">No songs in queue</p>
                  <p className="text-sm text-zinc-500 mt-1">Songs requested by customers will appear here</p>
                </div>
              )}
            </div>
          </>
        )}
      </main>
    </div>
  );
}
