import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Music2, ListMusic, LayoutList, ArrowLeft } from 'lucide-react';
import api from '../utils/api';
import QueueManager from '../components/venue/QueueManager';
import PlaylistManager from '../components/venue/PlaylistManager';

export default function VenuePlayer() {
  const { venueCode } = useParams();
  const navigate = useNavigate();
  const [venue, setVenue] = useState(null);
  const [queue, setQueue] = useState({ nowPlaying: null, upcoming: [] });
  const [activeTab, setActiveTab] = useState('playlist');

  useEffect(() => {
    const token = localStorage.getItem('votebeats_token');
    if (!token) {
      navigate('/venue/login');
      return;
    }

    api.getVenue(venueCode)
      .then((res) => setVenue(res.data))
      .catch(() => navigate('/venue/login'));

    fetchQueue();
    const interval = setInterval(fetchQueue, 3000);
    return () => clearInterval(interval);
  }, [venueCode, navigate]);

  async function fetchQueue() {
    try {
      const res = await api.getQueue(venueCode);
      setQueue(res.data);
    } catch {
      // keep showing last-known queue on transient errors
    }
  }

  async function handleSkip() {
    try {
      await api.skipSong(venueCode);
      fetchQueue();
    } catch (err) {
      console.error('Skip error:', err);
    }
  }

  async function handleRemove(songId) {
    try {
      await api.removeSong(venueCode, songId);
      fetchQueue();
    } catch (err) {
      console.error('Remove error:', err);
    }
  }

  if (!venue) {
    return (
      <div className="min-h-screen bg-dark-950 flex items-center justify-center">
        <div className="w-10 h-10 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-dark-950 text-white">
      {/* Header */}
      <header className="border-b border-dark-700 bg-dark-900">
        <div className="max-w-3xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => navigate('/venue/dashboard')}
              className="p-2 rounded-lg text-dark-400 hover:text-white hover:bg-dark-700 transition-colors"
            >
              <ArrowLeft className="h-5 w-5" />
            </button>
            <Music2 className="h-6 w-6 text-brand-400" />
            <div>
              <h1 className="font-bold text-white leading-tight">{venue.name}</h1>
              <p className="text-xs text-dark-400">Venue Player</p>
            </div>
          </div>
          <span className="text-xs font-mono bg-dark-700 text-dark-300 px-2 py-1 rounded">
            {venueCode}
          </span>
        </div>
      </header>

      {/* Tabs */}
      <div className="border-b border-dark-700 bg-dark-900">
        <div className="max-w-3xl mx-auto px-4">
          <div className="flex gap-1 py-2">
            <button
              type="button"
              onClick={() => setActiveTab('playlist')}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                activeTab === 'playlist'
                  ? 'bg-brand-500 text-white'
                  : 'text-dark-400 hover:text-white hover:bg-dark-700'
              }`}
            >
              <ListMusic className="h-4 w-4" />
              Playlist
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('queue')}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                activeTab === 'queue'
                  ? 'bg-brand-500 text-white'
                  : 'text-dark-400 hover:text-white hover:bg-dark-700'
              }`}
            >
              <LayoutList className="h-4 w-4" />
              Queue
              {(queue.upcoming?.length > 0 || queue.nowPlaying) && (
                <span className="ml-1 px-1.5 py-0.5 text-xs bg-dark-600 text-dark-300 rounded-full">
                  {(queue.nowPlaying ? 1 : 0) + (queue.upcoming?.length || 0)}
                </span>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Content */}
      <main className="max-w-3xl mx-auto px-4 py-6">
        {activeTab === 'playlist' && (
          <PlaylistManager venueCode={venueCode} />
        )}
        {activeTab === 'queue' && (
          <QueueManager
            queue={queue}
            onSkip={handleSkip}
            onRemove={handleRemove}
          />
        )}
      </main>
    </div>
  );
}
