import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../utils/api';
import Header from '../components/shared/Header';
import QRCodeDisplay from '../components/venue/QRCodeDisplay';
import QueueManager from '../components/venue/QueueManager';
import Settings from '../components/venue/Settings';
import EarningsCard from '../components/venue/EarningsCard';
import Button from '../components/shared/Button';

export default function VenueDashboard() {
  const [venue, setVenue] = useState(null);
  const [queue, setQueue] = useState({
    nowPlaying: null,
    upcoming: [],
    requestSettings: { autoplayQueue: true },
  });
  const [showSettings, setShowSettings] = useState(false);
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

  if (!venue) {
    return (
      <div className="min-h-screen bg-dark-950 flex justify-center items-center">
        <div className="w-10 h-10 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-dark-950 text-white pb-safe">
      <Header showHome={false} />
      <div className="container mx-auto px-5 py-6 max-w-2xl">
        <div className="flex flex-wrap justify-between items-start gap-4 mb-8">
          <div>
            <h1 className="text-2xl font-extrabold text-white">{venue.name}</h1>
            {venue.location && (
              <p className="text-dark-400 text-sm mt-1">{venue.location}</p>
            )}
            <p className="text-dark-500 text-sm mt-0.5 font-mono">Code: {venue.code}</p>
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => setShowSettings(!showSettings)}>
              {showSettings ? 'Hide settings' : 'Settings'}
            </Button>
            <Button variant="danger" onClick={handleLogout}>
              Logout
            </Button>
          </div>
        </div>

        {showSettings && (
          <div className="mb-8">
            <Settings venueCode={venue.code} onSaved={() => setShowSettings(false)} />
          </div>
        )}

        <div className="mb-8">
          <EarningsCard venueCode={venue.code} showPlaceholder={!venue.settings?.requirePaymentForRequest} />
        </div>

        <div className="mb-6 p-4 bg-dark-800 rounded-xl border border-dark-600">
          <p className="text-sm text-dark-300 mb-2">Venue Player (for playback device)</p>
          <a
            href={`/venue/player/${venue.code}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-brand-400 hover:text-brand-300 text-sm font-medium break-all"
          >
            /venue/player/{venue.code}
          </a>
          <p className="text-xs text-dark-500 mt-1 mb-4">
            Open on the device that plays music, authorize Apple Music once, then leave it open.
          </p>
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={queue.requestSettings?.autoplayQueue ?? true}
              onChange={async (e) => {
                const val = e.target.checked;
                try {
                  await api.updateSettings(venue.code, { autoplayQueue: val });
                  setQueue((q) => ({
                    ...q,
                    requestSettings: { ...q.requestSettings, autoplayQueue: val },
                  }));
                } catch (err) {
                  console.error(err);
                }
              }}
              className="rounded border-dark-500 text-brand-500 focus:ring-brand-500"
            />
            <span className="text-sm">Autoplay queue</span>
          </label>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          <QRCodeDisplay venueCode={venue.code} venueName={venue.name} />
          <QueueManager queue={queue} onSkip={handleSkip} onRemove={handleRemove} />
        </div>
      </div>
    </div>
  );
}
