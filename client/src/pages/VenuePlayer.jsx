import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import api from '../utils/api';
import { initMusicKit, getMusicInstance, unauthorizeMusicKit } from '../utils/musickit';
import Button from '../components/shared/Button';

const POLL_INTERVAL = 5000;

export default function VenuePlayer() {
  const { venueCode } = useParams();
  const navigate = useNavigate();
  const [queue, setQueue] = useState({ nowPlaying: null, upcoming: [] });
  const [isAuthorized, setIsAuthorized] = useState(false);
  const [autoplay, setAutoplay] = useState(true);
  const [musicReady, setMusicReady] = useState(false);
  const [error, setError] = useState(null);
  const lastPlayedIdRef = useRef(null);
  const playbackListenerRef = useRef(null);
  const autoplayFromServerRef = useRef(false);
  const [playbackBlocked, setPlaybackBlocked] = useState(false);
  const [previewDetected, setPreviewDetected] = useState(false);
  const playbackStartedAtRef = useRef(null);
  const expectedDurationRef = useRef(null);

  // Initialize MusicKit and check auth. Do NOT call unauthorize on load - it triggers 403 from Apple
  // and can corrupt the session, causing 30-sec preview playback even with a valid subscription.
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

  // Poll queue
  useEffect(() => {
    if (!venueCode) return;

    async function fetchQueue() {
      try {
        const res = await api.getQueue(venueCode);
        setQueue(res.data);
        setError(null);
      } catch (err) {
        setError('Could not load queue');
      }
    }

    async function load() {
      try {
        const res = await api.getQueue(venueCode);
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

  // Build full queue and start playback. Pass queueData to use fresh data (e.g. after song completed).
  const startPlaybackWithQueue = useCallback((queueData) => {
    const music = getMusicInstance();
    if (!music || !music.isAuthorized) return;

    const q = queueData || queue;
    const ids = [];
    if (q?.nowPlaying?.appleId) ids.push(String(q.nowPlaying.appleId));
    (q?.upcoming || []).forEach((s) => {
      if (s?.appleId) ids.push(String(s.appleId));
    });
    if (ids.length === 0) return;

    const opts = ids.length > 1 ? { songs: ids } : { song: ids[0] };
    const expectedSec = (queueData || queue)?.nowPlaying?.duration ? Number((queueData || queue).nowPlaying.duration) : 0;
    expectedDurationRef.current = expectedSec;

    music
      .setQueue(opts)
      .then(() => music.play())
      .then(() => {
        playbackStartedAtRef.current = Date.now();
        lastPlayedIdRef.current = ids[0];
        setPlaybackBlocked(false);
        if (venueCode && ids[0]) api.reportPlaying(venueCode, ids[0]).catch(() => {});
      })
      .catch((err) => {
        if (ids.length > 1) {
          music
            .setQueue({ song: ids[0] })
            .then(() => music.play())
            .then(() => {
              playbackStartedAtRef.current = Date.now();
              expectedDurationRef.current = (queueData || queue)?.nowPlaying?.duration ? Number((queueData || queue).nowPlaying.duration) : 0;
              lastPlayedIdRef.current = ids[0];
              setPlaybackBlocked(false);
              if (venueCode && ids[0]) api.reportPlaying(venueCode, ids[0]).catch(() => {});
            })
            .catch((e) => {
              console.error('Playback error:', e);
              setPlaybackBlocked(true);
            });
        } else {
          console.error('Playback error:', err);
          setPlaybackBlocked(true);
        }
      });
  }, [venueCode, queue?.nowPlaying?.appleId, queue?.upcoming]);

  const startPlayback = useCallback(() => startPlaybackWithQueue(null), [startPlaybackWithQueue]);

  // When MusicKit reports song completed: advance server, detect preview cutoff, and continue autoplay
  const handlePlaybackCompleted = useCallback(async () => {
    const expectedSec = expectedDurationRef.current || 0;
    const playedMs = playbackStartedAtRef.current ? Date.now() - playbackStartedAtRef.current : 0;
    const playedSec = playedMs / 1000;
    if (expectedSec > 60 && playedSec > 0 && playedSec < 45) {
      setPreviewDetected(true);
    }
    playbackStartedAtRef.current = null;
    expectedDurationRef.current = null;
    lastPlayedIdRef.current = null;
    await api.advanceQueue(venueCode).catch(() => {});

    // If autoplay is on, fetch updated queue and play next song (MusicKit may not always auto-advance)
    if (autoplayRef.current) {
      try {
        const res = await api.getQueue(venueCode);
        const q = res.data;
        const hasMore = q?.nowPlaying?.appleId || (q?.upcoming?.length ?? 0) > 0;
        if (hasMore) {
          setQueue(q);
          startPlaybackWithQueue(q);
        }
      } catch (_) {}
    }
  }, [venueCode, startPlaybackWithQueue]);

  const autoplayRef = useRef(autoplay);
  autoplayRef.current = autoplay;

  useEffect(() => {
    const music = getMusicInstance();
    if (!music || !music.isAuthorized || !venueCode) return;

    const handler = (e) => {
      if (e.state === 'completed') {
        handlePlaybackCompleted();
      }
    };

    playbackListenerRef.current = handler;
    music.addEventListener('playbackStateDidChange', handler);

    return () => {
      music.removeEventListener('playbackStateDidChange', playbackListenerRef.current);
    };
  }, [isAuthorized, venueCode, handlePlaybackCompleted]);

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
      <div className="min-h-screen bg-dark-950 text-white flex items-center justify-center p-6">
        <p className="text-dark-400">Missing venue code. Use /venue/player/YOUR_VENUE_CODE</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-dark-950 text-white pb-safe p-6">
      <div className="max-w-md mx-auto">
        <div className="flex items-center gap-3 mb-4">
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="text-dark-400 hover:text-white flex items-center gap-1 text-sm"
          >
            ← Back
          </button>
          <div className="flex-1" />
        </div>
        <h1 className="text-xl font-bold mb-2">Venue Player</h1>
        <p className="text-dark-400 text-sm mb-6 font-mono">Code: {venueCode}</p>

        {error && (
          <p className="mb-4 text-amber-400 text-sm bg-amber-500/10 border border-amber-500/30 rounded-lg px-4 py-2">
            {error}
          </p>
        )}

        {!musicReady ? (
          <p className="text-dark-400 text-sm">Loading MusicKit...</p>
        ) : !isAuthorized ? (
          /* Login required */
          <div className="rounded-2xl border-2 border-amber-500/50 bg-dark-800/80 p-8 text-center">
            <p className="text-amber-400 font-semibold text-lg mb-2">Login required</p>
            <p className="text-dark-300 text-sm mb-6">
              Sign in with Apple Music so songs play fully. Use an account with an active Apple Music subscription.
            </p>
            <Button onClick={handleAuthorize} className="w-full !py-4 !text-base font-bold">
              Sign in with Apple Music
            </Button>
          </div>
        ) : (
          <>
          {previewDetected && (
            <div className="mb-4 p-4 rounded-xl bg-red-500/10 border-2 border-red-500/50 text-red-300 text-sm">
              <p className="font-semibold">Songs stopped early</p>
              <p className="mt-1">Playback cut at ~30 seconds. In Apple Developer: add your site URL under Identifiers → Services IDs, and ensure the MusicKit Media ID matches. localhost often limits playback.</p>
            </div>
          )}
          {playbackBlocked && (queue?.nowPlaying || queue?.upcoming?.length) && (
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                startPlayback();
              }}
              className="mb-4 w-full py-4 px-4 rounded-xl bg-amber-500/20 border-2 border-amber-500 text-amber-300 font-bold text-center hover:bg-amber-500/30 active:bg-amber-500/40 transition-colors"
            >
              Tap here to start playback (plays entire queue)
            </button>
          )}
          <div className="mb-8 flex items-center justify-between gap-3">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={autoplay}
                onChange={(e) => setAutoplay(e.target.checked)}
                className="rounded"
              />
              <span className="text-sm">Autoplay queue</span>
            </label>
            <button
              type="button"
              onClick={async () => {
                await unauthorizeMusicKit().catch(() => {});
                setIsAuthorized(false);
              }}
              className="text-xs text-dark-400 hover:text-amber-400"
            >
              Sign out
            </button>
          </div>
          </>
        )}

        {/* Player and queue only shown after login */}
        <div className={`bg-dark-800 rounded-2xl border border-dark-600 p-6 ${!isAuthorized ? 'opacity-50 pointer-events-none' : ''}`}>
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-sm font-semibold text-dark-300">Now Playing</h2>
            <p className="text-xs text-dark-500">Tap Play once – queue plays automatically</p>
          </div>
          {queue.nowPlaying ? (
            <div className="flex items-center gap-4">
              <img
                src={queue.nowPlaying.albumArt}
                alt={queue.nowPlaying.title}
                className="w-16 h-16 rounded-xl object-cover"
              />
              <div className="flex-1 min-w-0">
                <p className="font-semibold truncate">{queue.nowPlaying.title}</p>
                <p className="text-sm text-dark-400 truncate">{queue.nowPlaying.artist}</p>
              </div>
              {(queue.nowPlaying.appleId || queue.upcoming?.length > 0) && (
                <Button onClick={startPlayback} className="shrink-0 !py-2 !px-4">
                  ▶ Play
                </Button>
              )}
            </div>
          ) : queue?.upcoming?.length > 0 ? (
            <div className="flex items-center justify-between">
              <p className="text-dark-400 text-sm">Songs in queue – tap Play to start</p>
              <Button onClick={startPlayback} className="shrink-0 !py-2 !px-4">
                ▶ Play all
              </Button>
            </div>
          ) : (
            <p className="text-dark-500 text-sm">No song playing</p>
          )}

          <h3 className="text-sm font-semibold text-dark-300 mt-6 mb-2">Upcoming</h3>
          {queue.upcoming?.length > 0 ? (
            <div className="space-y-2 max-h-48 overflow-y-auto">
              {queue.upcoming.slice(0, 5).map((s, i) => (
                <div key={s.id} className="flex items-center gap-3 p-2 bg-dark-700/50 rounded-lg">
                  <span className="text-dark-500 text-sm w-5">{i + 1}</span>
                  <img src={s.albumArt} alt="" className="w-10 h-10 rounded object-cover" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{s.title}</p>
                    <p className="text-xs text-dark-400 truncate">{s.artist}</p>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-dark-500 text-sm">No songs in queue</p>
          )}
        </div>
      </div>
    </div>
  );
}
