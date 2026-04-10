import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams } from 'react-router-dom';
import api from '../utils/api';
import socket from '../utils/socket';
import { isValidQueuePayload } from '../utils/socketValidation';
import { getDeviceId } from '../utils/deviceId';
import { useVisibilityAwarePolling } from '../hooks/useVisibilityAwarePolling';
import NowPlaying from '../components/customer/NowPlaying';
import UpcomingQueue from '../components/customer/UpcomingQueue';
import SearchBar from '../components/shared/SearchBar';
import Logo from '../components/shared/Logo';
import LyricsView from '../components/customer/LyricsView';
import VolumeSuggestion from '../components/customer/VolumeSuggestion';

export default function CustomerVoting() {
  const { venueCode } = useParams();
  const [queue, setQueue] = useState({ nowPlaying: null, upcoming: [], myVotes: {}, requestSettings: {} });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [requestError, setRequestError] = useState('');
  const [showLyrics, setShowLyrics] = useState(false);
  const [lyricsData, setLyricsData] = useState(null);
  const [isConnected, setIsConnected] = useState(socket.connected);
  // Only show the socket-based "Connection lost" banner after the first
  // successful connection — avoids a false alarm during the initial handshake.
  const hasConnectedOnceRef = useRef(socket.connected);
  const deviceId = getDeviceId();

  // Counts consecutive HTTP poll failures. We wait for ≥2 before showing the
  // error banner so a single transient blip (brief server wake-up, flaky cell
  // signal) doesn't flash "Connection lost" at the user.
  const httpFailCountRef = useRef(0);

  // Holds the latest fetchQueue function. Socket handlers read this ref so the
  // socket effect never needs to re-register just because fetchQueue changed.
  const fetchQueueRef = useRef(null);

  // AbortController for the in-flight getQueue request. Cancelled when a newer
  // fetch starts so stale responses never overwrite fresher data.
  const queueAbortRef = useRef(null);

  // Pre-fetch lyrics whenever the playing song changes
  useEffect(() => {
    const song = queue.nowPlaying;
    setShowLyrics(false);
    if (!song) { setLyricsData(null); return; }
    setLyricsData(null);
    const controller = new AbortController();
    api.getLyrics(song.title, song.artist, song.duration, { signal: controller.signal })
      .then((res) => {
        const { syncedLyrics, plainLyrics } = res.data;
        setLyricsData(syncedLyrics || plainLyrics ? { syncedLyrics, plainLyrics } : null);
      })
      .catch((err) => {
        if (err.name === 'CanceledError' || err.code === 'ERR_CANCELED') return;
        setLyricsData(null);
      });
    return () => controller.abort();
  }, [queue.nowPlaying?.appleId]);

  const fetchQueue = useCallback(async () => {
    if (!venueCode) return;
    // Cancel any in-flight request — its response would be stale
    queueAbortRef.current?.abort();
    queueAbortRef.current = new AbortController();
    try {
      const response = await api.getQueue(venueCode, deviceId, { signal: queueAbortRef.current.signal });
      setQueue(response.data);
      setError(null);
      httpFailCountRef.current = 0;
    } catch (err) {
      // Ignore cancellations — a newer request is already in flight
      if (err.name === 'CanceledError' || err.code === 'ERR_CANCELED') return;
      httpFailCountRef.current += 1;
      if (err.response?.status === 404) {
        setError('Venue not found');
      } else if (httpFailCountRef.current >= 2) {
        // Only surface the banner after 2 consecutive failures so a single
        // transient blip (Render cold-start, weak signal) doesn't alarm users.
        setError('Connection lost. Reconnecting…');
      }
    } finally {
      setLoading(false);
    }
  }, [venueCode, deviceId]);

  // Keep the ref current so socket handlers always invoke the latest version
  // of fetchQueue without needing to be re-registered when it changes.
  useEffect(() => {
    fetchQueueRef.current = fetchQueue;
  }, [fetchQueue]);

  // ── Socket.IO — primary real-time updates ────────────────────────────────
  useEffect(() => {
    if (!venueCode) return;

    function onConnect() {
      setIsConnected(true);
      hasConnectedOnceRef.current = true;
      // Clear any stale connection error and reset the failure counter so the
      // next poll starts fresh rather than immediately re-showing the banner.
      setError(null);
      httpFailCountRef.current = 0;
      socket.emit('join', venueCode);
      // Brief delay lets the server process the room join before we fetch,
      // ensuring the response belongs to this venue's room.
      setTimeout(() => fetchQueueRef.current?.(), 300);
    }

    function onDisconnect() {
      setIsConnected(false);
    }

    function onQueueUpdated(data) {
      if (!isValidQueuePayload(data)) return;
      setQueue((prev) => ({
        ...data,
        myVotes: prev.myVotes || data.myVotes || {},
        // Socket payload is queue-only; preserve last known values from GET
        reportedPlayerVolume: data.reportedPlayerVolume ?? prev.reportedPlayerVolume,
        requestSettings: data.requestSettings ?? prev.requestSettings,
      }));
      setError(null);
      setLoading(false);
    }

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('queue:updated', onQueueUpdated);

    // If the socket is already open (e.g., customer navigates back to the
    // page) the 'connect' event will never fire again, so join the room and
    // fetch immediately rather than waiting indefinitely.
    if (socket.connected) {
      onConnect();
    } else {
      socket.connect();
    }

    // Kick off an HTTP fetch right away — this resolves the loading state and
    // populates the queue even before the WebSocket handshake completes.
    fetchQueueRef.current?.();

    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('queue:updated', onQueueUpdated);
      socket.disconnect();
      // Cancel any in-flight queue request so it doesn't update unmounted state
      queueAbortRef.current?.abort();
    };
  // fetchQueue is intentionally omitted — we access it via fetchQueueRef so
  // the socket is never torn down just because the callback reference changed.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [venueCode]);

  // ── Fallback poll — visibility-aware, pauses when phone screen off ───────
  useVisibilityAwarePolling(fetchQueue, 15000);

  async function handleRequestSong(song, paymentInfo) {
    setRequestError('');
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
        setRequestError('Payment could not be started. Please try again.');
        return;
      } else {
        await api.requestSong(venueCode, song, deviceId);
        // Socket push will update the queue; also fetch to refresh myVotes
        fetchQueue();
      }
    } catch (err) {
      setRequestError(err.response?.data?.error || 'Error requesting song');
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-dark-950 text-white flex justify-center items-center pb-safe px-5">
        <div className="text-center max-w-xs">
          <Logo size="2xl" className="mx-auto mb-6 opacity-90" />
          <div className="w-10 h-10 border-2 border-brand-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-dark-400">Connecting to venue…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-dark-950 text-white pb-safe">
      <div className="container mx-auto px-5 py-6 max-w-lg">
        <header className="text-center mb-6">
          <Logo size="2xl" className="mx-auto mb-4" />
          <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-white">Be the vibe</h1>
          <p className="text-dark-400 text-sm mt-2">Vote and request what plays next</p>
        </header>

        {(error || (hasConnectedOnceRef.current && !isConnected)) && (
          <p className="mb-4 text-xs text-center text-amber-400 bg-dark-900 border border-amber-500/40 rounded-lg px-3 py-2">
            {error || 'Connection lost. Reconnecting…'}
          </p>
        )}

        <SearchBar
          venueCode={venueCode}
          onRequestSong={handleRequestSong}
          requestSettings={queue.requestSettings}
        />

        {requestError && (
          <div className="mb-4 flex items-center justify-between gap-2 px-3 py-2 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-sm">
            <span>{requestError}</span>
            <button onClick={() => setRequestError('')} className="shrink-0 text-red-400 hover:text-red-300">&times;</button>
          </div>
        )}

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
