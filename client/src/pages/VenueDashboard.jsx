import { useState, useEffect, useMemo, useCallback } from 'react';
import { useVisibilityAwarePolling } from '../hooks/useVisibilityAwarePolling';
import { useNavigate, Link } from 'react-router-dom';
import {
  Settings,
  LogOut,
  Copy,
  Check,
  MapPin,
  Hash,
  QrCode,
  ListMusic,
  Clock,
} from 'lucide-react';
import api from '../utils/api';
import { VENUE_PLAYER_META_REFRESH } from '../utils/venuePlayerEvents';
import Button from '../components/shared/Button';
import QRCodeDisplay from '../components/venue/QRCodeDisplay';
import QueueManager from '../components/venue/QueueManager';
import VenueSettings from '../components/venue/Settings';
import EarningsCard from '../components/venue/EarningsCard';
import AnalyticsDashboard from '../components/venue/AnalyticsDashboard';
import VolumeAlertsCard from '../components/venue/VolumeAlertsCard';
import RandomAutoplayCard from '../components/venue/RandomAutoplayCard';

export default function VenueDashboard() {
  const [venue, setVenue] = useState(null);
  const [queue, setQueue] = useState({
    nowPlaying: null,
    upcoming: [],
    requestSettings: { autoplayQueue: true },
  });
  const [showSettings, setShowSettings] = useState(false);
  const [copiedVotingUrl, setCopiedVotingUrl] = useState(false);
  const navigate = useNavigate();

  const fetchVenue = useCallback(async (code) => {
    try {
      const response = await api.getVenue(code);
      setVenue(response.data);
    } catch (err) {
      console.error('Error fetching venue:', err);
      navigate('/venue/login');
    }
  }, [navigate]);

  const fetchQueue = useCallback(async (code) => {
    try {
      const response = await api.getQueue(code);
      setQueue(response.data);
    } catch (err) {
      console.error('Error fetching queue:', err);
    }
  }, []);

  const pollQueue = useCallback(() => {
    const code = localStorage.getItem('speeldit_venue_code');
    if (code) fetchQueue(code);
  }, [fetchQueue]);

  useVisibilityAwarePolling(pollQueue, 3000);

  useEffect(() => {
    const venueCode = localStorage.getItem('speeldit_venue_code');

    if (!venueCode) {
      navigate('/venue/login');
      return;
    }

    fetchVenue(venueCode);
    fetchQueue(venueCode);
  }, [navigate, fetchVenue, fetchQueue]);

  useEffect(() => {
    const code = venue?.code;
    if (!code) return;
    const onVis = () => {
      if (document.visibilityState === 'visible') fetchVenue(code);
    };
    const onMeta = () => fetchVenue(code);
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener(VENUE_PLAYER_META_REFRESH, onMeta);
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener(VENUE_PLAYER_META_REFRESH, onMeta);
    };
  }, [venue?.code, fetchVenue]);

  async function handleSkip() {
    if (!venue) return;
    try {
      await api.skipSong(venue.code);
      fetchQueue(venue.code);
    } catch (err) {
      console.error('Error skipping:', err);
    }
  }

  async function handleRemove(songId) {
    if (!venue) return;
    try {
      await api.removeSong(venue.code, songId);
      fetchQueue(venue.code);
    } catch (err) {
      console.error('Error removing song:', err);
    }
  }

  async function handleBanArtist(artist) {
    if (!venue || !artist) return;
    try { await api.banArtist(venue.code, artist); } catch {}
  }

  async function handleLogout() {
    try { await api.logout(); } catch {}
    localStorage.removeItem('speeldit_logged_in');
    localStorage.removeItem('speeldit_venue_code');
    navigate('/venue/login');
  }

  const baseUrl =
    import.meta.env.VITE_PUBLIC_URL ||
    (typeof window !== 'undefined' ? window.location.origin : '');
  const votingUrl = `${baseUrl.replace(/\/$/, '')}/v/${venue?.code || ''}`;

  const copyToClipboard = (text) => {
    navigator.clipboard.writeText(text);
    setCopiedVotingUrl(true);
    setTimeout(() => setCopiedVotingUrl(false), 2000);
  };

  const effectiveAutoplayMode = useMemo(() => {
    if (!venue?.settings) return 'playlist';
    if (venue.settings.autoplayQueue === false) return 'off';
    return venue.settings.autoplayMode || 'playlist';
  }, [venue?.settings]);

  const activePlaylistName = useMemo(() => {
    const pls = venue?.playlists || [];
    if (!pls.length) return null;
    const id = venue?.activePlaylistId || pls[0]?.id;
    return pls.find((p) => p.id === id)?.name ?? null;
  }, [venue?.playlists, venue?.activePlaylistId]);

  if (!venue) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-zinc-50 to-zinc-100 flex justify-center items-center">
        <div className="w-10 h-10 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-zinc-50 to-zinc-100">
      {/* Header */}
      <header className="bg-white border-b border-zinc-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center justify-between">
            <span className="font-bold text-zinc-900 text-lg">Dashboard</span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setShowSettings(!showSettings)}
                className="flex items-center gap-2 px-3 py-2.5 text-sm font-medium text-zinc-700 border border-zinc-300 rounded-lg hover:bg-zinc-50 transition-colors min-h-[44px]"
              >
                <Settings className="h-4 w-4 shrink-0" />
                <span className="hidden sm:inline">Settings</span>
              </button>
              <button
                type="button"
                onClick={handleLogout}
                className="flex items-center gap-2 px-3 py-2.5 text-sm font-medium text-zinc-700 border border-zinc-300 rounded-lg hover:bg-zinc-50 transition-colors min-h-[44px]"
              >
                <LogOut className="h-4 w-4 shrink-0" />
                <span className="hidden sm:inline">Logout</span>
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Settings Panel */}
        {showSettings && (
          <div className="mb-8">
            <VenueSettings venueCode={venue.code} onSaved={() => setShowSettings(false)} variant="light" />
          </div>
        )}

        {/* Venue Info */}
        <div className="mb-8">
          <h2 className="text-2xl sm:text-3xl font-semibold text-zinc-900 mb-2">{venue.name}</h2>
          <div className="flex flex-wrap items-center gap-3 text-sm text-zinc-600">
            {venue.location && (
              <div className="flex items-center gap-1.5">
                <MapPin className="h-4 w-4" />
                <span>{venue.location}</span>
              </div>
            )}
            <div className="flex items-center gap-1.5">
              <Hash className="h-4 w-4" />
              <span>Code: {venue.code}</span>
            </div>
          </div>
        </div>

        {/* Pay-to-Play Earnings */}
        <div className="mb-6 p-6 bg-white rounded-xl border border-zinc-200 shadow-sm">
          <EarningsCard
            venueCode={venue.code}
            showPlaceholder={!venue.settings?.requirePaymentForRequest}
            variant="light"
            embedded
          />
        </div>

        {/* Browse & schedule playlists (Figma-style) */}
        <div className="mb-6 p-6 bg-white rounded-xl border border-zinc-200 shadow-sm">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div className="flex items-start gap-3">
              <div className="p-2 bg-orange-100 rounded-lg">
                <ListMusic className="h-5 w-5 text-orange-600" />
              </div>
              <div>
                <h3 className="text-sm font-medium text-zinc-600 uppercase tracking-wide mb-1">
                  Playlists &amp; schedule
                </h3>
                <p className="text-sm text-zinc-500 max-w-xl">
                  Set the active playlist and schedule different playlists by time of day. Autofill shuffles from the
                  playlist that matches the current slot; customer requests are unchanged.
                </p>
                {effectiveAutoplayMode === 'playlist' && (
                  <div className="mt-3 max-w-xl rounded-lg border border-orange-100 bg-orange-50/90 px-3 py-2.5 text-sm">
                    <span className="text-zinc-600">Autoplay is on </span>
                    <span className="font-semibold text-zinc-800">playlist</span>
                    <span className="text-zinc-600"> mode — active library: </span>
                    {activePlaylistName ? (
                      <Link
                        to="/venue/playlists"
                        className="font-semibold text-brand-600 hover:text-brand-700 hover:underline"
                      >
                        {activePlaylistName}
                      </Link>
                    ) : (
                      <span className="text-amber-800 font-medium">None set yet — open Browse &amp; schedule to choose one.</span>
                    )}
                  </div>
                )}
              </div>
            </div>
            <button
              type="button"
              onClick={() => navigate('/venue/playlists')}
              className="shrink-0 inline-flex items-center justify-center gap-2 text-sm font-semibold px-4 py-2.5 rounded-lg bg-brand-500 text-white hover:bg-brand-600 transition-colors min-h-[44px]"
            >
              <Clock className="h-4 w-4" />
              Browse &amp; schedule
            </button>
          </div>
        </div>

        <RandomAutoplayCard
          venueCode={venue.code}
          effectiveAutoplayMode={effectiveAutoplayMode}
          onSaved={() => fetchVenue(venue.code)}
        />

        <VolumeAlertsCard venueCode={venue.code} variant="light" />

        {/* Analytics */}
        <div className="mb-6 p-6 bg-white rounded-xl border border-zinc-200 shadow-sm">
          <AnalyticsDashboard venueCode={venue.code} variant="light" />
        </div>

        {/* Bottom Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Customer Voting Link */}
          <div className="p-6 bg-white rounded-xl border border-zinc-200 shadow-sm">
            <div className="flex items-start gap-3 mb-4">
              <div className="p-2 bg-purple-100 rounded-lg">
                <QrCode className="h-5 w-5 text-purple-600" />
              </div>
              <div className="flex-1">
                <h3 className="text-sm font-medium text-zinc-600 uppercase tracking-wide mb-1">
                  Customer Voting Link
                </h3>
                <p className="text-sm text-zinc-500">
                  Scan with your phone to vote on music at {venue.name}
                </p>
              </div>
            </div>
            <QRCodeDisplay venueCode={venue.code} venueName={venue.name} variant="light" />
            <div className="flex items-center gap-2 mt-4">
              <code className="flex-1 px-3 py-2 bg-zinc-50 border border-zinc-200 rounded-lg text-xs text-zinc-600 font-mono break-all">
                {votingUrl}
              </code>
              <button
                type="button"
                onClick={() => copyToClipboard(votingUrl)}
                className="p-2 border border-zinc-300 rounded-lg hover:bg-zinc-50 transition-colors shrink-0"
              >
                {copiedVotingUrl ? (
                  <Check className="h-4 w-4 text-green-600" />
                ) : (
                  <Copy className="h-4 w-4 text-zinc-600" />
                )}
              </button>
            </div>
          </div>

          {/* Queue */}
          <div className="p-6 bg-white rounded-xl border border-zinc-200 shadow-sm">
            <div className="flex items-start gap-3 mb-4">
              <div className="p-2 bg-green-100 rounded-lg">
                <ListMusic className="h-5 w-5 text-green-600" />
              </div>
              <div className="flex-1">
                <h3 className="text-sm font-medium text-zinc-600 uppercase tracking-wide mb-1">
                  Queue
                </h3>
              </div>
            </div>
            <QueueManager
              queue={queue}
              onSkip={handleSkip}
              onRemove={handleRemove}
              onBan={handleBanArtist}
              variant="light"
            />
          </div>
        </div>
      </main>
    </div>
  );
}
