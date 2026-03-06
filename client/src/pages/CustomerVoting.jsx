import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import api from '../utils/api';
import { getDeviceId } from '../utils/deviceId';
import NowPlaying from '../components/customer/NowPlaying';
import UpcomingQueue from '../components/customer/UpcomingQueue';
import SearchBar from '../components/shared/SearchBar';
import LyricsView from '../components/customer/LyricsView';

export default function CustomerVoting() {
  const { venueCode } = useParams();
  const navigate = useNavigate();
  const [queue, setQueue] = useState({ nowPlaying: null, upcoming: [], requestSettings: {} });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showLyrics, setShowLyrics] = useState(false);
  const [lyricsData, setLyricsData] = useState(null); // pre-fetched lyrics for current song
  const deviceId = getDeviceId();

  // Pre-fetch lyrics whenever the playing song changes so the button only shows when lyrics exist
  useEffect(() => {
    const song = queue.nowPlaying;
    setShowLyrics(false); // close overlay whenever the song changes
    if (!song) { setLyricsData(null); return; }
    setLyricsData(null);
    api.getLyrics(song.title, song.artist, song.duration)
      .then((res) => {
        const { syncedLyrics, plainLyrics } = res.data;
        setLyricsData(syncedLyrics || plainLyrics ? { syncedLyrics, plainLyrics } : null);
      })
      .catch(() => setLyricsData(null));
  }, [queue.nowPlaying?.appleId]);

  useEffect(() => {
    if (!venueCode) return;
    fetchQueue();
    const interval = setInterval(fetchQueue, 2000);
    return () => clearInterval(interval);
  }, [venueCode]);

  async function fetchQueue() {
    try {
      const response = await api.getQueue(venueCode, deviceId);
      setQueue(response.data);
      setError(null);
    } catch (err) {
      if (err.response?.status === 404) {
        setError('Venue not found');
      } else {
        // Soft error: show warning but keep existing queue data
        setError('Could not refresh queue. Showing latest saved data.');
      }
    } finally {
      setLoading(false);
    }
  }

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
        // Payment API responded but gave no redirect — treat as a server error
        alert('Payment could not be started. Please try again.');
        return;
      } else {
        await api.requestSong(venueCode, song, deviceId);
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
          <p className="text-dark-400">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-dark-950 text-white pb-safe">
      <div className="container mx-auto px-5 py-6 max-w-lg">
        <h1 className="text-2xl font-extrabold mb-4 text-center tracking-tight">Vote on the Music</h1>

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
          />
        )}

        {showLyrics && queue.nowPlaying && (
          <LyricsView
            song={queue.nowPlaying}
            lyricsData={lyricsData}
            onClose={() => setShowLyrics(false)}
          />
        )}

        <UpcomingQueue songs={queue.upcoming} />
      </div>
    </div>
  );
}
