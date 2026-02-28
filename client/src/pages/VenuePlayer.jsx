import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Music2, ListMusic, LayoutList, ArrowLeft,
  Play, Pause, SkipBack, SkipForward, Volume2,
} from 'lucide-react';
import api from '../utils/api';
import QueueManager from '../components/venue/QueueManager';
import PlaylistManager from '../components/venue/PlaylistManager';
import { formatDuration } from '../utils/helpers';

export default function VenuePlayer() {
  const { venueCode } = useParams();
  const navigate = useNavigate();

  const [venue, setVenue] = useState(null);
  const [queue, setQueue] = useState({ nowPlaying: null, upcoming: [] });
  const [activeTab, setActiveTab] = useState('playlist');

  // Playback state
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackTime, setPlaybackTime] = useState(0);
  const [playbackDuration, setPlaybackDuration] = useState(0);
  const [isAuthorized, setIsAuthorized] = useState(false);
  const [musicReady, setMusicReady] = useState(false);
  const [waitingForGesture, setWaitingForGesture] = useState(false);
  const [volume, setVolume] = useState(() => {
    const saved = localStorage.getItem('votebeats_volume');
    return saved !== null ? Number(saved) : 70;
  });

  // Autoplay mode: 'off' | 'playlist' | 'random'
  const [autoplayMode, setAutoplayMode] = useState('playlist');

  // AI playlist generation state
  const [generateStatus, setGenerateStatus] = useState(null); // null | 'generating' | { added: number } | { error: string }

  const musicRef = useRef(null);
  const currentSongIdRef = useRef(null);
  const isTransitioningRef = useRef(false);
  const autoplayModeRef = useRef(autoplayMode);
  useEffect(() => { autoplayModeRef.current = autoplayMode; }, [autoplayMode]);

  // ── Initialize MusicKit ──────────────────────────────────────────────────
  useEffect(() => {
    const token = localStorage.getItem('votebeats_token');
    if (!token) { navigate('/venue/login'); return; }

    async function init() {
      try {
        // Reuse existing instance if already configured (prevents resetting on navigation)
        let music;
        try { music = MusicKit.getInstance(); } catch {}
        if (!music) {
          const res = await api.getDeveloperToken();
          const devToken = res.data?.token || res.data?.developerToken;
          if (!devToken) return;
          await MusicKit.configure({
            developerToken: devToken,
            app: { name: 'VoteBeats', build: '1.0' },
          });
          music = MusicKit.getInstance();
        }

        musicRef.current = music;
        music.volume = volume / 100;
        setIsAuthorized(music.isAuthorized);
        setMusicReady(true);

        // Sync UI with current playback state (important after remount)
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
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Volume sync ──────────────────────────────────────────────────────────
  useEffect(() => {
    localStorage.setItem('votebeats_volume', String(volume));
    if (musicRef.current) musicRef.current.volume = volume / 100;
  }, [volume]);

  // ── Detect ?generatePlaylist=1 after Yoco redirect, call generate endpoint ──
  useEffect(() => {
    if (!venueCode) return;
    const params = new URLSearchParams(window.location.search);
    if (params.get('generatePlaylist') !== '1') return;

    // Strip the query param from the URL without reloading
    window.history.replaceState({}, '', window.location.pathname);

    const checkoutId = localStorage.getItem(`votebeats_generate_${venueCode}`);
    if (!checkoutId) return;
    const savedPrompt = localStorage.getItem(`votebeats_generate_prompt_${venueCode}`) || '';
    localStorage.removeItem(`votebeats_generate_${venueCode}`);
    localStorage.removeItem(`votebeats_generate_prompt_${venueCode}`);

    setActiveTab('playlist');
    setGenerateStatus('generating');

    api.generatePlaylist(venueCode, checkoutId, savedPrompt)
      .then((res) => setGenerateStatus({ added: res.data.added?.length ?? 0 }))
      .catch((err) => setGenerateStatus({ error: err.response?.data?.error || 'Generation failed' }));
  }, [venueCode]);

  // ── Fetch venue + load saved autoplayMode ────────────────────────────────
  useEffect(() => {
    if (!venueCode) return;
    api.getVenue(venueCode)
      .then((res) => {
        setVenue(res.data);
        const saved = res.data?.settings?.autoplayMode;
        if (saved) setAutoplayMode(saved);
        else if (res.data?.settings?.autoplayQueue === false) setAutoplayMode('off');
      })
      .catch(() => navigate('/venue/login'));
  }, [venueCode, navigate]);

  // ── Play a song via MusicKit ─────────────────────────────────────────────
  const playSong = useCallback(async (song) => {
    const music = musicRef.current;
    if (!music || !song?.appleId) return;
    try {
      if (!music.isAuthorized) await music.authorize();
      setIsAuthorized(music.isAuthorized);
      try { await music.stop(); } catch {}   // clear any residual audio before loading new track
      await music.setQueue({ songs: [song.appleId] });
      await music.play();
      setWaitingForGesture(false);
      await api.reportPlaying(venueCode, song.id);
    } catch (err) {
      // Browser autoplay policy blocks play() without a prior user gesture
      if (err?.message?.toLowerCase().includes('interact') || err?.name === 'NotAllowedError') {
        setWaitingForGesture(true);
      } else {
        console.error('Play error:', err);
      }
      isTransitioningRef.current = false;
    }
  }, [venueCode]);

  // ── Autofill ─────────────────────────────────────────────────────────────
  const tryAutofill = useCallback(async () => {
    if (autoplayModeRef.current === 'off') return;
    try {
      await api.autofillQueue(venueCode);
    } catch (err) {
      console.error('Autofill error:', err);
    }
  }, [venueCode]);

  // ── Poll queue ───────────────────────────────────────────────────────────
  const fetchQueue = useCallback(async () => {
    try {
      const res = await api.getQueue(venueCode);
      const newQueue = res.data;
      setQueue(newQueue);

      const nowPlaying = newQueue.nowPlaying;

      if (nowPlaying && nowPlaying.id !== currentSongIdRef.current && !isTransitioningRef.current) {
        // If MusicKit is already playing this song (e.g. after navigating back), just sync the ref
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
        await tryAutofill();
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

  // ── Song end → advance then autofill ─────────────────────────────────────
  useEffect(() => {
    const music = musicRef.current;
    if (!music) return;

    async function onStateChange() {
      if (music.playbackState === 5 && currentSongIdRef.current) {
        currentSongIdRef.current = null;
        isTransitioningRef.current = true;   // block poller until transition completes
        try {
          await api.advanceQueue(venueCode);
          if (autoplayModeRef.current !== 'off') await tryAutofill();
        } catch {}
        isTransitioningRef.current = false;
      }
    }

    music.addEventListener('playbackStateDidChange', onStateChange);
    return () => music.removeEventListener('playbackStateDidChange', onStateChange);
  }, [venueCode, tryAutofill]);

  // ── Player controls ──────────────────────────────────────────────────────
  async function handlePlayPause() {
    const music = musicRef.current;
    if (!music) return;
    setWaitingForGesture(false);
    if (music.playbackState === 2) await music.pause();
    else await music.play();
  }

  async function handleSkip() {
    const music = musicRef.current;
    if (music) { try { await music.stop(); } catch {} }
    currentSongIdRef.current = null;
    isTransitioningRef.current = true;  // block poller until skip resolves
    try {
      await api.skipSong(venueCode);
      isTransitioningRef.current = false;  // allow fetchQueue to play next song
      await fetchQueue();
    } catch (err) {
      console.error('Skip error:', err);
      isTransitioningRef.current = false;
    }
  }

  async function handlePrev() {
    const music = musicRef.current;
    if (!music) return;
    if ((music.currentPlaybackTime || 0) > 3) {
      await music.seekToTime(0);
    } else {
      try { await music.skipToPreviousItem(); } catch { await music.seekToTime(0); }
    }
  }

  async function handleChangeMode(mode) {
    setAutoplayMode(mode);
    autoplayModeRef.current = mode;
    await api.updateSettings(venueCode, {
      autoplayQueue: mode !== 'off',
      autoplayMode: mode,
    }).catch(console.error);
  }

  async function handleAuthorize() {
    const music = musicRef.current;
    if (!music) return;
    try {
      await music.authorize();
      setIsAuthorized(music.isAuthorized);
    } catch (err) { console.error('Auth error:', err); }
  }

  async function handleRemoveSong(songId) {
    try { await api.removeSong(venueCode, songId); fetchQueue(); } catch {}
  }

  const nowPlaying = queue.nowPlaying;
  const progress = playbackDuration > 0 ? (playbackTime / playbackDuration) * 100 : 0;

  if (!venue) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-zinc-50 to-zinc-100 flex items-center justify-center">
        <div className="w-10 h-10 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-zinc-50 to-zinc-100 text-zinc-900 flex flex-col">
      {/* ── Header ── */}
      <header className="border-b border-zinc-200 bg-white shrink-0">
        <div className="max-w-3xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => navigate('/venue/dashboard')}
              className="p-2 rounded-lg text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100 transition-colors"
            >
              <ArrowLeft className="h-5 w-5" />
            </button>
            <Music2 className="h-5 w-5 text-brand-600" />
            <span className="font-bold text-zinc-900">{venue.name}</span>
          </div>
          <span className="text-xs font-mono bg-zinc-100 text-zinc-500 px-2 py-1 rounded">
            {venueCode}
          </span>
        </div>
      </header>

      {/* ── Now Playing Player ── */}
      <div className="bg-white border-b border-zinc-200 shrink-0">
        <div className="max-w-3xl mx-auto px-4 py-5">
          {/* Song info row */}
          <div className="flex items-center gap-4 mb-4">
            <div className="w-16 h-16 rounded-xl shrink-0 overflow-hidden bg-zinc-100 flex items-center justify-center">
              {nowPlaying?.albumArt
                ? <img src={nowPlaying.albumArt} alt={nowPlaying.title} className="w-full h-full object-cover" />
                : <Music2 className="h-6 w-6 text-zinc-400" />}
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-bold text-zinc-900 truncate text-lg">
                {nowPlaying?.title || 'Nothing playing'}
              </p>
              <p className="text-sm text-zinc-500 truncate">
                {nowPlaying?.artist || 'Add songs to playlist or queue'}
              </p>
            </div>
            {musicReady && !isAuthorized && (
              <button
                type="button"
                onClick={handleAuthorize}
                className="text-xs px-3 py-1.5 rounded-lg bg-brand-500 text-white shrink-0 hover:bg-brand-600"
              >
                Connect Apple Music
              </button>
            )}
          </div>

          {/* Progress bar */}
          <div className="mb-4">
            <div className="w-full bg-zinc-200 rounded-full h-1.5 overflow-hidden">
              <div
                className="bg-brand-500 h-1.5 rounded-full transition-all duration-500"
                style={{ width: `${progress}%` }}
              />
            </div>
            <div className="flex justify-between text-xs text-zinc-400 mt-1">
              <span>{formatDuration(Math.floor(playbackTime))}</span>
              <span>{formatDuration(Math.floor(playbackDuration))}</span>
            </div>
          </div>

          {/* Controls + Volume */}
          <div className="flex items-center justify-between gap-4">
            {/* Playback buttons */}
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={handlePrev}
                className="w-10 h-10 flex items-center justify-center rounded-full text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100 transition-colors"
              >
                <SkipBack className="h-5 w-5" />
              </button>
              <div className="relative">
                <button
                  type="button"
                  onClick={handlePlayPause}
                  className="w-12 h-12 flex items-center justify-center rounded-full bg-brand-500 text-white hover:bg-brand-600 transition-colors"
                >
                  {isPlaying
                    ? <Pause className="h-5 w-5" />
                    : <Play className="h-5 w-5 ml-0.5" />}
                </button>
                {waitingForGesture && (
                  <span className="absolute -top-8 left-1/2 -translate-x-1/2 whitespace-nowrap text-xs bg-zinc-800 text-white px-2 py-1 rounded-md pointer-events-none">
                    Tap to play
                  </span>
                )}
              </div>
              <button
                type="button"
                onClick={handleSkip}
                className="w-10 h-10 flex items-center justify-center rounded-full text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100 transition-colors"
              >
                <SkipForward className="h-5 w-5" />
              </button>
            </div>

            {/* Volume */}
            <div className="flex items-center gap-2 flex-1 max-w-40">
              <Volume2 className="h-4 w-4 text-zinc-400 shrink-0" />
              <input
                type="range"
                min="0"
                max="100"
                value={volume}
                onChange={(e) => setVolume(Number(e.target.value))}
                className="w-full accent-brand-500 cursor-pointer"
                style={{ height: '4px' }}
              />
            </div>
          </div>

          {/* Autoplay mode */}
          <div className="flex items-center gap-2 mt-4 pt-4 border-t border-zinc-200">
            <span className="text-xs text-zinc-500 mr-1">Autoplay:</span>
            {[
              { id: 'off', label: 'Off' },
              { id: 'playlist', label: 'Playlist' },
              { id: 'random', label: 'Random' },
            ].map(({ id, label }) => (
              <button
                key={id}
                type="button"
                onClick={() => handleChangeMode(id)}
                className={`px-3 py-1 rounded-full text-xs font-semibold transition-colors ${
                  autoplayMode === id
                    ? 'bg-brand-500 text-white'
                    : 'bg-zinc-100 text-zinc-500 hover:text-zinc-900'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── Tabs ── */}
      <div className="border-b border-zinc-200 bg-white shrink-0">
        <div className="max-w-3xl mx-auto px-4">
          <div className="flex gap-1 py-2">
            {[
              { id: 'playlist', Icon: ListMusic, label: 'Playlist' },
              { id: 'queue', Icon: LayoutList, label: 'Queue' },
            ].map(({ id, Icon, label }) => (
              <button
                key={id}
                type="button"
                onClick={() => setActiveTab(id)}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                  activeTab === id
                    ? 'bg-brand-500 text-white'
                    : 'text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100'
                }`}
              >
                <Icon className="h-4 w-4" />
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── Generate playlist status banner ── */}
      {generateStatus && (
        <div className={`shrink-0 border-b border-zinc-200 ${generateStatus === 'generating' ? 'bg-blue-50' : generateStatus.error ? 'bg-red-50' : 'bg-green-50'}`}>
          <div className="max-w-3xl mx-auto px-4 py-2 flex items-center justify-between gap-3">
            <p className={`text-sm font-medium ${generateStatus === 'generating' ? 'text-blue-700' : generateStatus.error ? 'text-red-700' : 'text-green-700'}`}>
              {generateStatus === 'generating'
                ? '✨ Generating your AI playlist… this takes ~30 seconds'
                : generateStatus.error
                  ? `Generation failed: ${generateStatus.error}`
                  : `✅ Added ${generateStatus.added} songs to your playlist!`}
            </p>
            {generateStatus !== 'generating' && (
              <button type="button" onClick={() => setGenerateStatus(null)} className="text-xs text-zinc-400 hover:text-zinc-600 shrink-0">Dismiss</button>
            )}
          </div>
        </div>
      )}

      {/* ── Tab content ── */}
      <main className="flex-1 max-w-3xl w-full mx-auto px-4 py-6">
        {activeTab === 'playlist' && <PlaylistManager venueCode={venueCode} variant="light" />}
        {activeTab === 'queue' && (
          <QueueManager queue={queue} onSkip={handleSkip} onRemove={handleRemoveSong} variant="light" />
        )}
      </main>
    </div>
  );
}
