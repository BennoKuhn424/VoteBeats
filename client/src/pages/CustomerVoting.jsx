import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import api from '../utils/api';
import socket from '../utils/socket';
import { getDeviceId } from '../utils/deviceId';
import { useVisibilityAwarePolling } from '../hooks/useVisibilityAwarePolling';
import NowPlaying from '../components/customer/NowPlaying';
import UpcomingQueue from '../components/customer/UpcomingQueue';
import SearchBar from '../components/shared/SearchBar';
import LyricsView from '../components/customer/LyricsView';
import VolumeSuggestion from '../components/customer/VolumeSuggestion';

export default function CustomerVoting() {
  const { venueCode } = useParams();
  const [queue, setQueue] = useState({ nowPlaying: null, upcoming: [], myVotes: {}, requestSettings: {} });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showLyrics, setShowLyrics] = useState(false);
  const [lyricsData, setLyricsData] = useState(null);
  const deviceId = getDeviceId();
  

  // Pre-fetch lyrics whenever the playing song changes
  useEffect(() => {
    const song = queue.nowPlaying;
    setShowLyrics(false);
    if (!song) { setLyricsData(null); return; }
    setLyricsData(null);
    api.getLyrics(song.title, song.artist, song.duration)
      .then((res) => {
        const { syncedLyrics, plainLyrics } = res.data;
        setLyricsData(syncedLyrics || plainLyrics ? { syncedLyrics, plainLyrics } : null);
      })
      .catch(() => setLyricsData(null));
  }, [queue.nowPlaying?.appleId]);

  const fetchQueue = useCallback(async () => {
    if (!venueCode) return;
    try {
      const response = await api.getQueue(venueCode, deviceId);
      setQueue(response.data);
      setError(null);
    } catch (err) {
      if (err.response?.status === 404) {
        setError('Venue not found');
      } else {
        // Soft error — keep existing queue data visible
        setError('Connection lost. Reconnecting…');
      }
    } finally {
      setLoading(false);
    }
  }, [venueCode, deviceId]);

  // ── Socket.IO — primary real-time updates ────────────────────────────────
  useEffect(() => {
    if (!venueCode) return;

    function joinRoom() {
      socket.emit('join', venueCode);
    }

    socket.connect();
    joinRoom();

    function onConnect() {
      joinRoom();
      setTimeout(fetchQueue, 300);
    }

    function onQueueUpdated(data) {
      setQueue((prev) => ({
        ...data,
        myVotes: prev.myVotes || data.myVotes || {},
        // Socket payload is queue-only; keep last known volume hint from GET
        reportedPlayerVolume: data.reportedPlayerVolume ?? prev.reportedPlayerVolume,
        requestSettings: data.requestSettings ?? prev.requestSettings,
      }));
      setError(null);
      setLoading(false);
    }

    socket.on('connect', onConnect);
    socket.on('queue:updated', onQueueUpdated);

    // Initial fetch
    fetchQueue();

    return () => {
      socket.off('connect', onConnect);
      socket.off('queue:updated', onQueueUpdated);
      socket.disconnect();
    };
  }, [venueCode, fetchQueue]);

  // ── Fallback poll — visibility-aware, pauses when phone screen off ───────
  useVisibilityAwarePolling(fetchQueue, 15000);

  async function handleRequestSong(song, paymentInfo) {
    try {
      if (paymentInfo?.requiresPayment) {
        const res = await api.createPayment(venueCode, song, deviceId);
        if (res.data?.redirectUrl) {
          if (res.data.checkoutId) {
            const key = `speeldit_checkout_${venueCode}`;
            const id = res.data.checkoutId;
            sessionStorage.setItem(key, id);
            localStorage.setItem(key, id);
            document.cookie = `speeldit_checkout_${venueCode}=${id}; path=/; max-age=600; SameSite=Lax`;
          }
          window.location.href = res.data.redirectUrl;
          return;
        }
        alert('Payment could not be started. Please try again.');
        return;
      } else {
        await api.requestSong(venueCode, song, deviceId);
        // Socket push will update the queue; also fetch to refresh myVotes
        fetchQueue();
      }
    } catch (err) {
      alert(err.response?.data?.error || 'Error requesting song');
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-dark-950 text-white flex justify-center items-center pb-safe">
        <div className="text-center">
          <div className="w-10 h-10 border-2 border-brand-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-dark-400">Connecting to venue…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-dark-950 text-white pb-safe">
      <div className="container mx-auto px-5 py-6 max-w-lg">
        <h1 className="text-2xl font-extrabold mb-4 text-center tracking-tight">You Pick the Vibe 🎶</h1>

        {error && (
          <p className="mb-4 text-xs text-center text-amber-400 bg-dark-900 border border-amber-500/40 rounded-lg px-3 py-2">
            {error}
          </p>
        )}

        <SearchBar
          venueCode={venueCode}
          onRequestSong={handleRequestSong}
          requestSettings={queue.requestSettings}
        />

        {queue.nowPlaying && (
          <NowPlaying
            song={queue.nowPlaying}
            hasLyrics={!!lyricsData}
            onLyrics={() => setShowLyrics(true)}
            venueCode={venueCode}
            deviceId={deviceId}
            myVote={queue.myVotes?.[queue.nowPlaying.id] ?? null}
            onVote={fetchQueue}
          />
        )}

        {showLyrics && queue.nowPlaying && (
          <LyricsView
            song={queue.nowPlaying}
            lyricsData={lyricsData}
            onClose={() => setShowLyrics(false)}
          />
        )}

        <UpcomingQueue
          songs={queue.upcoming}
          myVotes={queue.myVotes}
          venueCode={venueCode}
          deviceId={deviceId}
          onVote={fetchQueue}
        />

        <VolumeSuggestion
          venueCode={venueCode}
          deviceId={deviceId}
          reportedPlayerVolume={queue.reportedPlayerVolume}
        />
      </div>
    </div>
  );
}
