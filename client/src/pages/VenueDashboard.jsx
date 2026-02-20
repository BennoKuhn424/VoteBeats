import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Music2,
  Settings,
  LogOut,
  Copy,
  Check,
  MapPin,
  Hash,
  DollarSign,
  Monitor,
  QrCode,
  ListMusic,
} from 'lucide-react';
import api from '../utils/api';
import Button from '../components/shared/Button';
import QRCodeDisplay from '../components/venue/QRCodeDisplay';
import QueueManager from '../components/venue/QueueManager';
import VenueSettings from '../components/venue/Settings';
import EarningsCard from '../components/venue/EarningsCard';

export default function VenueDashboard() {
  const [venue, setVenue] = useState(null);
  const [queue, setQueue] = useState({
    nowPlaying: null,
    upcoming: [],
    requestSettings: { autoplayQueue: true },
  });
  const [showSettings, setShowSettings] = useState(false);
  const [copiedPlayerUrl, setCopiedPlayerUrl] = useState(false);
  const [copiedVotingUrl, setCopiedVotingUrl] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    const token = localStorage.getItem('votebeats_token');
    const venueCode = localStorage.getItem('votebeats_venue_code');

    if (!token || !venueCode) {
      navigate('/venue/login');
      return;
    }

    fetchVenue(venueCode);
    fetchQueue(venueCode);

    const interval = setInterval(() => fetchQueue(venueCode), 3000);
    return () => clearInterval(interval);
  }, [navigate]);

  async function fetchVenue(code) {
    try {
      const response = await api.getVenue(code);
      setVenue(response.data);
    } catch (err) {
      console.error('Error fetching venue:', err);
      navigate('/venue/login');
    }
  }

  async function fetchQueue(code) {
    try {
      const response = await api.getQueue(code);
      setQueue(response.data);
    } catch (err) {
      console.error('Error fetching queue:', err);
    }
  }

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

  function handleLogout() {
    localStorage.removeItem('votebeats_token');
    localStorage.removeItem('votebeats_venue_code');
    navigate('/venue/login');
  }

  const baseUrl =
    import.meta.env.VITE_PUBLIC_URL ||
    (typeof window !== 'undefined' ? window.location.origin : '');
  const playerUrl = `${baseUrl.replace(/\/$/, '')}/venue/player/${venue?.code || ''}`;
  const votingUrl = `${baseUrl.replace(/\/$/, '')}/v/${venue?.code || ''}`;

  const copyToClipboard = (text, type) => {
    navigator.clipboard.writeText(text);
    if (type === 'player') {
      setCopiedPlayerUrl(true);
      setTimeout(() => setCopiedPlayerUrl(false), 2000);
    } else {
      setCopiedVotingUrl(true);
      setTimeout(() => setCopiedVotingUrl(false), 2000);
    }
  };

  const autoplayQueue = queue.requestSettings?.autoplayQueue ?? true;
  const setAutoplayQueue = async (val) => {
    if (!venue) return;
    try {
      await api.updateSettings(venue.code, { autoplayQueue: val });
      setQueue((q) => ({
        ...q,
        requestSettings: { ...q.requestSettings, autoplayQueue: val },
      }));
    } catch (err) {
      console.error(err);
    }
  };

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
            <div className="flex items-center gap-3">
              <Music2 className="h-7 w-7 text-brand-600" />
              <h1 className="text-xl font-semibold text-zinc-900">VoteBeats</h1>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setShowSettings(!showSettings)}
                className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-zinc-700 border border-zinc-300 rounded-lg hover:bg-zinc-50 transition-colors"
              >
                <Settings className="h-4 w-4" />
                Settings
              </button>
              <button
                type="button"
                onClick={handleLogout}
                className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-zinc-700 border border-zinc-300 rounded-lg hover:bg-zinc-50 transition-colors"
              >
                <LogOut className="h-4 w-4" />
                Logout
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
          <h2 className="text-3xl font-semibold text-zinc-900 mb-2">{venue.name}</h2>
          <div className="flex items-center gap-4 text-sm text-zinc-600">
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

        {/* Grid Layout */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
          {/* Pay-to-Play Earnings */}
          <div className="p-6 bg-white rounded-xl border border-zinc-200 shadow-sm">
            <EarningsCard
              venueCode={venue.code}
              showPlaceholder={!venue.settings?.requirePaymentForRequest}
              variant="light"
              embedded
            />
          </div>

          {/* Venue Player */}
          <div className="p-6 bg-white rounded-xl border border-zinc-200 shadow-sm">
            <div className="flex items-start gap-3 mb-4">
              <div className="p-2 bg-blue-100 rounded-lg">
                <Monitor className="h-5 w-5 text-blue-600" />
              </div>
              <div className="flex-1">
                <h3 className="text-sm font-medium text-zinc-600 uppercase tracking-wide mb-1">
                  Venue Player
                </h3>
                <p className="text-sm text-zinc-500 mb-3">For playback device</p>
              </div>
            </div>
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <code className="flex-1 px-3 py-2 bg-zinc-50 border border-zinc-200 rounded-lg text-sm text-brand-600 font-mono truncate">
                  {playerUrl}
                </code>
                <button
                  type="button"
                  onClick={() => copyToClipboard(playerUrl, 'player')}
                  className="p-2 border border-zinc-300 rounded-lg hover:bg-zinc-50 transition-colors shrink-0"
                >
                  {copiedPlayerUrl ? (
                    <Check className="h-4 w-4 text-green-600" />
                  ) : (
                    <Copy className="h-4 w-4 text-zinc-600" />
                  )}
                </button>
              </div>
              <button
                type="button"
                onClick={() => navigate(`/venue/player/${venue.code}`)}
                className="text-sm text-brand-600 hover:text-brand-500 font-medium text-left"
              >
                Open Venue Player →
              </button>
              <div
                role="button"
                tabIndex={0}
                onClick={() => setAutoplayQueue(!autoplayQueue)}
                onKeyDown={(e) => e.key === 'Enter' && setAutoplayQueue(!autoplayQueue)}
                className="flex items-center gap-2 pt-2 cursor-pointer"
              >
                <span
                  role="switch"
                  aria-checked={autoplayQueue}
                  className={`relative inline-flex h-6 w-11 shrink-0 rounded-full border-2 border-transparent transition-colors ${
                    autoplayQueue ? 'bg-zinc-900' : 'bg-zinc-200'
                  }`}
                >
                  <span
                    className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition ${
                      autoplayQueue ? 'translate-x-5' : 'translate-x-1'
                    }`}
                  />
                </span>
                <span className="text-sm text-zinc-700">Autoplay queue</span>
              </div>
            </div>
          </div>
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
                onClick={() => copyToClipboard(votingUrl, 'voting')}
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
              variant="light"
            />
          </div>
        </div>
      </main>
    </div>
  );
}
