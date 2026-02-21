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
  const [playbackBlocked, setPlaybackBlocked] = useState(false);
  const [previewDetected, setPreviewDetected] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  const lastPlayedIdRef = useRef(null);
  const autoplayFromServerRef = useRef(false);
  const autoplayRef = useRef(autoplay);
  autoplayRef.current = autoplay;

  const playbackStartedAtRef = useRef(null);
  const expectedDurationRef = useRef(null);

  const isTransitioningRef = useRef(false);
  const autofillCooldownRef = useRef(0);
  const autofillDisabledRef = useRef(false);
  const mountedRef = useRef(true);
  const songEndHandledRef = useRef(false);

  // ── MusicKit init ──
  useEffect(() => {
    mountedRef.current = true;
    async function setup() {
      const music = await initMusicKit();
      if (!mountedRef.current || !music) return;
      setMusicReady(true);
      setIsAuthorized(music.isAuthorized);

      if (music.isAuthorized && music.nowPlayingItem) {
        const currentAppleId = String(music.nowPlayingItem.id || '');
        if (currentAppleId) {
          lastPlayedIdRef.current = currentAppleId;
          playbackStartedAtRef.current = Date.now();
          songEndHandledRef.current = false;
          setIsPlaying(music.playbackState === 2);
        }
      }
    }
    setup();
    return () => { mountedRef.current = false; };
  }, []);

  // ── Safe stop helper ──
  const safeStop = useCallback(async () => {
    const music = getMusicInstance();
    if (!music) return;
    try {
      if (typeof music.stop === 'function') await music.stop();
      else if (typeof music.pause === 'function') music.pause();
    } catch (_) {}
  }, []);

  // ── Core playback: stop current, set queue, play ──
  const playSong = useCallback(async (appleId, queueData) => {
    const music = getMusicInstance();
    if (!music || !music.isAuthorized || !appleId) return false;
    if (isTransitioningRef.current) return false;
    isTransitioningRef.current = true;
    // #region agent log
    fetch('http://127.0.0.1:7848/ingest/1b5cee5d-f79e-40b3-af13-4867a90cb5b3',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'b2b520'},body:JSON.stringify({sessionId:'b2b520',location:'VenuePlayer.jsx:playSong',message:'playSong CALLED',data:{appleId,prevLastId:lastPlayedIdRef.current,mkState:music.playbackState,mkTime:music.currentPlaybackTime,mkDur:music.currentPlaybackDuration},timestamp:Date.now(),hypothesisId:'D'})}).catch(()=>{}); console.warn('[VB_DEBUG] playSong CALLED',{appleId,prevLastId:lastPlayedIdRef.current});
    // #endregion

    try {
      await safeStop();
      await new Promise((r) => setTimeout(r, 150));

      const ids = [String(appleId)];
      const upcoming = queueData?.upcoming || [];
      upcoming.forEach((s) => { if (s?.appleId) ids.push(String(s.appleId)); });

      await music.setQueue(ids.length > 1 ? { songs: ids } : { song: ids[0] });
      await music.play();

      expectedDurationRef.current = queueData?.nowPlaying?.duration ? Number(queueData.nowPlaying.duration) : 0;
      playbackStartedAtRef.current = Date.now();
      lastPlayedIdRef.current = String(appleId);
      songEndHandledRef.current = false;
      setIsPlaying(true);
      setPlaybackBlocked(false);

      if (venueCode) api.reportPlaying(venueCode, String(appleId)).catch(() => {});
      // #region agent log
      fetch('http://127.0.0.1:7848/ingest/1b5cee5d-f79e-40b3-af13-4867a90cb5b3',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'b2b520'},body:JSON.stringify({sessionId:'b2b520',location:'VenuePlayer.jsx:playSong-ok',message:'playSong SUCCESS',data:{appleId,mkState:music.playbackState,mkTime:music.currentPlaybackTime,mkDur:music.currentPlaybackDuration},timestamp:Date.now(),hypothesisId:'D'})}).catch(()=>{}); console.warn('[VB_DEBUG] playSong SUCCESS',{appleId});
      // #endregion

      isTransitioningRef.current = false;
      return true;
    } catch (err) {
      console.error('playSong error:', err);
      try {
        await music.setQueue({ song: String(appleId) });
        await music.play();
        lastPlayedIdRef.current = String(appleId);
        playbackStartedAtRef.current = Date.now();
        songEndHandledRef.current = false;
        setIsPlaying(true);
        setPlaybackBlocked(false);
        if (venueCode) api.reportPlaying(venueCode, String(appleId)).catch(() => {});
        isTransitioningRef.current = false;
        return true;
      } catch (e2) {
        console.error('playSong fallback error:', e2);
        setPlaybackBlocked(true);
        isTransitioningRef.current = false;
        return false;
      }
    }
  }, [venueCode, safeStop]);

  // ── Autofill: fetch song from venue's autoplay genre ──
  const tryAutofill = useCallback(async () => {
    if (autofillDisabledRef.current) return false;
    if (Date.now() < autofillCooldownRef.current) return false;
    autofillCooldownRef.current = Date.now() + 20000;

    try {
      const res = await api.autofillQueue(venueCode);
      // #region agent log
      fetch('http://127.0.0.1:7848/ingest/1b5cee5d-f79e-40b3-af13-4867a90cb5b3',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'b2b520'},body:JSON.stringify({sessionId:'b2b520',location:'VenuePlayer.jsx:autofill-result',message:'autofill response',data:{filled:res.data?.filled,songId:res.data?.song?.appleId,songTitle:res.data?.song?.title},timestamp:Date.now(),hypothesisId:'F'})}).catch(()=>{}); console.warn('[VB_DEBUG] autofill result',{filled:res.data?.filled,songId:res.data?.song?.appleId,title:res.data?.song?.title});
      // #endregion
      if (res.data?.filled && res.data?.song) {
        const q = { nowPlaying: res.data.song, upcoming: [] };
        setQueue(q);
        return await playSong(res.data.song.appleId, q);
      }
      return false;
    } catch (err) {
      if (err?.response?.status === 400) {
        autofillDisabledRef.current = true;
      } else {
        autofillCooldownRef.current = Date.now() + 30000;
      }
      return false;
    }
  }, [venueCode, playSong]);

  // ── Song ended handler (called from progress timer, NOT from MusicKit events) ──
  const handleSongEnd = useCallback(async () => {
    if (!mountedRef.current || isTransitioningRef.current) return;
    if (songEndHandledRef.current) return;

    // Final safety: verify MusicKit actually finished (not mid-transition)
    const _m = getMusicInstance();
    const _ps = _m?.playbackState;
    if (_ps === 2 || _ps === 1 || _ps === 6 || _ps === 8) return;

    songEndHandledRef.current = true;
    // #region agent log
    fetch('http://127.0.0.1:7848/ingest/1b5cee5d-f79e-40b3-af13-4867a90cb5b3',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'b2b520'},body:JSON.stringify({sessionId:'b2b520',location:'VenuePlayer.jsx:handleSongEnd',message:'handleSongEnd CALLED - song will be removed',data:{lastPlayedId:lastPlayedIdRef.current,elapsed:playbackStartedAtRef.current?(Date.now()-playbackStartedAtRef.current)/1000:null,mkTime:_m?.currentPlaybackTime,mkDur:_m?.currentPlaybackDuration,mkState:_ps},timestamp:Date.now(),hypothesisId:'verified'})}).catch(()=>{}); console.warn('[VB_DEBUG] handleSongEnd CALLED',{lastId:lastPlayedIdRef.current,mkState:_ps,mkTime:_m?.currentPlaybackTime,mkDur:_m?.currentPlaybackDuration});
    // #endregion

    const expectedSec = expectedDurationRef.current || 0;
    const playedMs = playbackStartedAtRef.current ? Date.now() - playbackStartedAtRef.current : 0;
    const playedSec = playedMs / 1000;
    if (expectedSec > 60 && playedSec > 0 && playedSec < 45) setPreviewDetected(true);

    playbackStartedAtRef.current = null;
    expectedDurationRef.current = null;
    lastPlayedIdRef.current = null;
    setIsPlaying(false);

    await api.advanceQueue(venueCode).catch(() => {});

    if (!autoplayRef.current) return;

    try {
      const res = await api.getQueue(venueCode);
      const q = res.data;
      setQueue(q);
      const nextId = q?.nowPlaying?.appleId;
      if (nextId) {
        await playSong(nextId, q);
      } else {
        await tryAutofill();
      }
    } catch (_) {}
  }, [venueCode, playSong, tryAutofill]);

  // ── Skip button ──
  const handleSkip = useCallback(async () => {
    if (isTransitioningRef.current) return;
    songEndHandledRef.current = true;
    await safeStop();
    lastPlayedIdRef.current = null;
    setIsPlaying(false);

    try {
      await api.advanceQueue(venueCode);
      const res = await api.getQueue(venueCode);
      const q = res.data;
      setQueue(q);
      const nextId = q?.nowPlaying?.appleId;
      if (nextId) {
        await playSong(nextId, q);
      } else if (autoplayRef.current) {
        await tryAutofill();
      }
    } catch (_) {}
  }, [venueCode, playSong, tryAutofill, safeStop]);

  // ── Play/Pause toggle ──
  const togglePlayPause = useCallback(async () => {
    const music = getMusicInstance();
    if (!music?.isAuthorized) return;

    if (isPlaying) {
      try { music.pause(); } catch (_) {}
      setIsPlaying(false);
      return;
    }

    const nowId = queue?.nowPlaying?.appleId;
    if (nowId) {
      if (lastPlayedIdRef.current === String(nowId)) {
        try { await music.play(); setIsPlaying(true); } catch (_) {}
      } else {
        await playSong(nowId, queue);
      }
    } else if (autoplayRef.current) {
      await tryAutofill();
    }
  }, [isPlaying, queue, playSong, tryAutofill]);

  const handlePrev = useCallback(() => {
    const music = getMusicInstance();
    if (music?.skipToPreviousItem) {
      music.skipToPreviousItem().catch(() => {});
    }
  }, []);

  // ── MusicKit event listener: ONLY for play/pause UI, NEVER advances queue ──
  useEffect(() => {
    const music = getMusicInstance();
    if (!music || !music.isAuthorized) return;

    const handler = (e) => {
      // #region agent log
      fetch('http://127.0.0.1:7848/ingest/1b5cee5d-f79e-40b3-af13-4867a90cb5b3',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'b2b520'},body:JSON.stringify({sessionId:'b2b520',location:'VenuePlayer.jsx:mkEvent',message:'MusicKit state change',data:{state:e.state,oldState:e.oldState,lastId:lastPlayedIdRef.current,songEndHandled:songEndHandledRef.current},timestamp:Date.now(),hypothesisId:'E'})}).catch(()=>{}); console.warn('[VB_DEBUG] MK event',e.state);
      // #endregion
      if (e.state === 'playing') setIsPlaying(true);
      else if (e.state === 'paused') setIsPlaying(false);
    };

    music.addEventListener('playbackStateDidChange', handler);
    return () => music.removeEventListener('playbackStateDidChange', handler);
  }, [isAuthorized]);

  // ── Polling loop ──
  useEffect(() => {
    if (!venueCode) return;

    async function load() {
      try {
        const res = await api.getQueue(venueCode);
        const serverNowId = res.data?.nowPlaying?.appleId ? String(res.data.nowPlaying.appleId) : null;
        const currentId = lastPlayedIdRef.current ? String(lastPlayedIdRef.current) : null;

        setQueue(res.data);

        if (!autoplayFromServerRef.current) {
          const fromServer = res.data?.requestSettings?.autoplayQueue;
          if (fromServer !== undefined) {
            setAutoplay(fromServer);
            autoplayFromServerRef.current = true;
          }
        }

        if (res.data?.requestSettings?.hasAutoplayGenre === false) {
          autofillDisabledRef.current = true;
        } else if (res.data?.requestSettings?.hasAutoplayGenre === true) {
          autofillDisabledRef.current = false;
        }

        const music = getMusicInstance();
        if (!music?.isAuthorized || isTransitioningRef.current) return;

        const mkNowId = music.nowPlayingItem ? String(music.nowPlayingItem.id || '') : null;
        const mkIsPlaying = music.playbackState === 2;

        if (serverNowId && currentId && serverNowId !== currentId) {
          // #region agent log
          fetch('http://127.0.0.1:7848/ingest/1b5cee5d-f79e-40b3-af13-4867a90cb5b3',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'b2b520'},body:JSON.stringify({sessionId:'b2b520',location:'VenuePlayer.jsx:poll-diff',message:'POLL: server song CHANGED, switching',data:{serverNowId,currentId,mkNowId,mkIsPlaying},timestamp:Date.now(),hypothesisId:'F'})}).catch(()=>{}); console.warn('[VB_DEBUG] POLL: server changed song',{serverNowId,currentId});
          // #endregion
          await playSong(serverNowId, res.data);
          return;
        }

        if (serverNowId && !currentId) {
          if (mkNowId === serverNowId && mkIsPlaying) {
            lastPlayedIdRef.current = serverNowId;
            playbackStartedAtRef.current = playbackStartedAtRef.current || Date.now();
            songEndHandledRef.current = false;
            setIsPlaying(true);
          } else if (autoplayRef.current) {
            await playSong(serverNowId, res.data);
          }
          return;
        }

        const queueEmpty = !serverNowId && (!res.data?.upcoming || res.data.upcoming.length === 0);
        if (queueEmpty && autoplayRef.current && !autofillDisabledRef.current) {
          // #region agent log
          fetch('http://127.0.0.1:7848/ingest/1b5cee5d-f79e-40b3-af13-4867a90cb5b3',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'b2b520'},body:JSON.stringify({sessionId:'b2b520',location:'VenuePlayer.jsx:poll-autofill',message:'POLL: queue empty, calling autofill',data:{serverNowId,currentId,mkNowId},timestamp:Date.now(),hypothesisId:'F'})}).catch(()=>{}); console.warn('[VB_DEBUG] POLL: queue empty, autofilling');
          // #endregion
          await tryAutofill();
        }

        setError(null);
      } catch (err) {
        setError('Could not load queue');
      }
    }

    load();
    const interval = setInterval(load, POLL_INTERVAL);
    return () => clearInterval(interval);
  }, [venueCode, playSong, tryAutofill]);

  // ── Progress timer: tracks position AND detects real song end ──
  useEffect(() => {
    const tick = setInterval(() => {
      if (!mountedRef.current) return;
      const music = getMusicInstance();
      if (!music) return;

      try {
        const t = music.currentPlaybackTime || 0;
        const d = music.currentPlaybackDuration || 0;
        setCurrentTime(t);
        setDuration(d);

        // Detect real song end: playback position reached end of track
        if (d > 10 && t >= d - 1.5 && !songEndHandledRef.current && lastPlayedIdRef.current) {
          // #region agent log
          fetch('http://127.0.0.1:7848/ingest/1b5cee5d-f79e-40b3-af13-4867a90cb5b3',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'b2b520'},body:JSON.stringify({sessionId:'b2b520',location:'VenuePlayer.jsx:timer-songend',message:'SONG END condition triggered',data:{t,d,diff:d-t,lastId:lastPlayedIdRef.current,handled:songEndHandledRef.current},timestamp:Date.now(),hypothesisId:'B'})}).catch(()=>{}); console.warn('[VB_DEBUG] SONG END trigger',{t,d,diff:d-t});
          // #endregion
          handleSongEnd();
        }

        // Stall detection REMOVED - was causing false song removals during transitions
      } catch (_) {}
    }, 500);
    return () => clearInterval(tick);
  }, [isAuthorized, handleSongEnd]);

  // ── Volume ──
  useEffect(() => {
    const music = getMusicInstance();
    if (!music) return;
    try { music.volume = volume / 100; } catch (_) {}
  }, [volume]);

  // ── Apple Music authorization ──
  async function handleAuthorize() {
    const music = getMusicInstance();
    if (!music) {
      setError('MusicKit not loaded. Check Apple Music configuration.');
      return;
    }
    try {
      await music.authorize();
      setIsAuthorized(music.isAuthorized);
      autofillDisabledRef.current = false;
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

            <div className="mb-6 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  role="switch"
                  aria-checked={autoplay}
                  onClick={() => {
                    setAutoplay(!autoplay);
                    if (!autoplay) autofillDisabledRef.current = false;
                  }}
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
                  <p className="text-sm text-zinc-500 mt-1">Songs will auto-play when autoplay is on</p>
                </div>
              )}

              {playbackBlocked && (queue?.nowPlaying || queue?.upcoming?.length) && (
                <button
                  type="button"
                  onClick={() => {
                    const id = queue?.nowPlaying?.appleId;
                    if (id) playSong(id, queue);
                  }}
                  className="mb-4 w-full py-3 px-4 rounded-xl bg-amber-100 border-2 border-amber-400 text-amber-800 font-bold text-center hover:bg-amber-200"
                >
                  Tap to start playback
                </button>
              )}

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

              {/* Progress bar */}
              {duration > 0 && (
                <div className="mb-5">
                  <div className="w-full h-1.5 bg-zinc-200 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-brand-500 rounded-full transition-all duration-500"
                      style={{ width: `${Math.min((currentTime / duration) * 100, 100)}%` }}
                    />
                  </div>
                  <div className="flex justify-between mt-1.5">
                    <span className="text-xs text-zinc-500 tabular-nums">
                      {Math.floor(currentTime / 60)}:{String(Math.floor(currentTime % 60)).padStart(2, '0')}
                    </span>
                    <span className="text-xs text-zinc-500 tabular-nums">
                      {Math.floor(duration / 60)}:{String(Math.floor(duration % 60)).padStart(2, '0')}
                    </span>
                  </div>
                </div>
              )}

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
