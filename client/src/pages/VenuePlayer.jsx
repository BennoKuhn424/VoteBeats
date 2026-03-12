import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Music2, ListMusic, LayoutList, ArrowLeft,
  Play, Pause, SkipBack, SkipForward, Volume2,
} from 'lucide-react';
import api from '../utils/api';
import QueueManager from '../components/venue/QueueManager';
import PlaylistManager from '../components/venue/PlaylistManager';
import { formatDuration } from '../utils/helpers';
import { useVenuePlayback } from '../context/VenuePlaybackContext';

export default function VenuePlayer() {
  const { venueCode } = useParams();
  const navigate = useNavigate();
  const playback = useVenuePlayback();

  const [venue, setVenue] = useState(null);
  const [activeTab, setActiveTab] = useState('playlist');
  const [generateStatus, setGenerateStatus] = useState(null);

  const {
    queue,
    fetchQueue,
    isPlaying,
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
    musicRef,
    currentSongIdRef,
    isTransitioningRef,
  } = playback;

  // ── Detect ?generatePlaylist=1 after Yoco redirect ────────────────────────
  useEffect(() => {
    if (!venueCode) return;
    const params = new URLSearchParams(window.location.search);
    if (params.get('generatePlaylist') !== '1') return;

    window.history.replaceState({}, '', window.location.pathname);
    const checkoutId = localStorage.getItem(`speeldit_generate_${venueCode}`);
    if (!checkoutId) return;
    const savedPrompt = localStorage.getItem(`speeldit_generate_prompt_${venueCode}`) || '';
    const savedPlaylistId = localStorage.getItem(`speeldit_generate_playlist_${venueCode}`) || 'pl_default';
    const savedCount = Number(localStorage.getItem(`speeldit_generate_count_${venueCode}`)) || 100;
    localStorage.removeItem(`speeldit_generate_${venueCode}`);
    localStorage.removeItem(`speeldit_generate_prompt_${venueCode}`);
    localStorage.removeItem(`speeldit_generate_playlist_${venueCode}`);
    localStorage.removeItem(`speeldit_generate_count_${venueCode}`);

    setActiveTab('playlist');
    setGenerateStatus('generating');

    api.generatePlaylist(venueCode, savedPlaylistId, checkoutId, savedPrompt, savedCount)
      .then((res) => setGenerateStatus({ added: res.data.added?.length ?? 0 }))
      .catch((err) => setGenerateStatus({ error: err.response?.data?.error || 'Generation failed' }));
  }, [venueCode]);

  // ── Fetch venue + sync autoplayMode ───────────────────────────────────────
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
  }, [venueCode, navigate, setAutoplayMode]);

  // ── Player controls ──────────────────────────────────────────────────────
  async function handlePlayPause() {
    const music = musicRef.current;
    if (!music) return;
    const wasWaiting = waitingForGesture;
    setWaitingForGesture(false);
    const state = music.playbackState;
    const nowPlaying = queue.nowPlaying;

    if (state === 2) {
      // Currently playing → pause
      await music.pause();
    } else if (wasWaiting && nowPlaying) {
      // Autoplay was blocked by browser — queue is already set in MusicKit from the
      // failed autoplay attempt. Call play() directly to stay within the iOS gesture
      // chain (fewest possible awaits before play()).
      try {
        await music.play();
      } catch (err) {
        if (err?.message?.toLowerCase().includes('interact') || err?.name === 'NotAllowedError') {
          setWaitingForGesture(true);
        } else {
          // Queue may have changed since last attempt — do full load
          currentSongIdRef.current = nowPlaying.id;
          await playSong(nowPlaying);
        }
      }
    } else if (state === 3) {
      // Paused — if server advanced to a newer song, play that; otherwise resume
      if (nowPlaying && nowPlaying.id !== currentSongIdRef.current) {
        currentSongIdRef.current = nowPlaying.id;
        await playSong(nowPlaying);
      } else {
        try {
          await music.play();
        } catch (err) {
          if (err?.message?.toLowerCase().includes('interact') || err?.name === 'NotAllowedError') {
            setWaitingForGesture(true);
          } else {
            console.error('Play error:', err);
          }
        }
      }
    } else if (state === 0 || state === 4 || state === 5) {
      // Nothing loaded / stopped / ended — load the current song and play
      if (nowPlaying) {
        currentSongIdRef.current = nowPlaying.id;
        await playSong(nowPlaying);
      }
    }
  }

  async function handleSkip() {
    const music = musicRef.current;
    if (music) { try { await music.stop(); } catch {} }
    currentSongIdRef.current = null;
    isTransitioningRef.current = true;
    try {
      await api.skipSong(venueCode);
      isTransitioningRef.current = false;
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
      playback.setIsAuthorized(music.isAuthorized);
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

      <div className="bg-white border-b border-zinc-200 shrink-0">
        <div className="max-w-3xl mx-auto px-4 py-5">
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

          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={handlePrev}
                className="w-10 h-10 flex items-center justify-center rounded-full text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100 transition-colors"
              >
                <SkipBack className="h-5 w-5" />
              </button>
              <div className="relative flex flex-col items-center gap-1">
                <button
                  type="button"
                  onClick={handlePlayPause}
                  className={`w-14 h-14 flex items-center justify-center rounded-full text-white transition-all duration-200 ${
                    isPlaying
                      ? 'bg-brand-500 hover:bg-brand-600 shadow-md'
                      : 'bg-brand-500 hover:bg-brand-600 shadow-lg ring-4 ring-brand-200 animate-pulse'
                  }`}
                >
                  {isPlaying
                    ? <Pause className="h-6 w-6" />
                    : <Play className="h-6 w-6 ml-0.5" />}
                </button>
                <span className="text-xs font-medium text-zinc-500 select-none">
                  {isPlaying ? 'Playing' : waitingForGesture ? 'Tap to play' : 'Paused'}
                </span>
              </div>
              <button
                type="button"
                onClick={handleSkip}
                className="w-10 h-10 flex items-center justify-center rounded-full text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100 transition-colors"
              >
                <SkipForward className="h-5 w-5" />
              </button>
            </div>
            <div className="flex items-center gap-2 flex-1 max-w-xs">
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

          <div className="flex flex-wrap items-center gap-2 mt-4 pt-4 border-t border-zinc-200">
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
                className={`px-4 py-2 rounded-full text-xs font-semibold transition-colors min-h-[36px] ${
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

      <main className="flex-1 max-w-3xl w-full mx-auto px-4 py-6">
        {activeTab === 'playlist' && <PlaylistManager venueCode={venueCode} variant="light" />}
        {activeTab === 'queue' && (
          <QueueManager queue={queue} onSkip={handleSkip} onRemove={handleRemoveSong} variant="light" />
        )}
      </main>
    </div>
  );
}
