import { useState, useEffect } from 'react';
import api from '../../utils/api';
import Button from '../shared/Button';

export default function Settings({ venueCode, onSaved, variant = 'dark' }) {
  const [allowExplicit, setAllowExplicit] = useState(false);
  const [explicitMode, setExplicitMode] = useState('off'); // 'off' | 'always' | 'scheduled'
  const [explicitAfterHour, setExplicitAfterHour] = useState(18);
  const [maxSongsPerUser, setMaxSongsPerUser] = useState(3);
  const [genreFilters, setGenreFilters] = useState('');
  const [requirePaymentForRequest, setRequirePaymentForRequest] = useState(false);
  const [requestPriceCents, setRequestPriceCents] = useState(1000);
  const [autoplayQueue, setAutoplayQueue] = useState(true);
  const [autoplayGenres, setAutoplayGenres] = useState([]);
  const [playlistSchedule, setPlaylistSchedule] = useState([]);
  const [playlists, setPlaylists] = useState([]);
  const [saving, setSaving] = useState(false);

  const GENRE_SECTIONS = [
    {
      label: 'Genres',
      items: [
        'Pop', 'Rock', 'Hip-Hop', 'R&B', 'Electronic', 'Jazz', 'Classical',
        'Country', 'Folk', 'Reggae', 'Latin', 'Afrobeat', 'Amapiano',
        'House', 'Dance', 'Indie', 'Alternative', 'Punk', 'Metal', 'Soul', 'Funk',
        'Blues', 'Gospel', 'Lo-Fi', 'Ambient', 'Techno', 'EDM', 'Trap', 'Kwaito',
      ],
    },
    {
      label: 'Languages',
      items: [
        'Afrikaans', 'English', 'Spanish', 'French', 'Portuguese', 'German', 'Italian',
        'Zulu', 'Xhosa', 'Sotho', 'Tswana', 'Korean', 'Japanese', 'Arabic', 'Hindi',
      ],
    },
  ];

  function toggleGenre(g) {
    setAutoplayGenres((prev) =>
      prev.includes(g) ? prev.filter((x) => x !== g) : [...prev, g]
    );
  }

  useEffect(() => {
    if (!venueCode) return;
    api
      .getVenue(venueCode)
      .then((res) => {
        const s = res.data?.settings || {};
        setAllowExplicit(s.allowExplicit ?? false);
        if (typeof s.explicitAfterHour === 'number') {
          setExplicitMode('scheduled');
          setExplicitAfterHour(s.explicitAfterHour);
        } else {
          setExplicitMode(s.allowExplicit ? 'always' : 'off');
        }
        setMaxSongsPerUser(s.maxSongsPerUser ?? 3);
        setPlaylists(res.data?.playlists || []);
        setPlaylistSchedule(Array.isArray(s.playlistSchedule) ? s.playlistSchedule : []);
        setGenreFilters(Array.isArray(s.genreFilters) ? s.genreFilters.join(', ') : '');
        setRequirePaymentForRequest(s.requirePaymentForRequest ?? false);
        setRequestPriceCents(s.requestPriceCents ?? 1000);
        setAutoplayQueue(s.autoplayQueue ?? true);
        const ag = s.autoplayGenre;
        setAutoplayGenres(Array.isArray(ag) ? ag : (ag ? [ag] : []));
      })
      .catch(console.error);
  }, [venueCode]);

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true);
    try {
      await api.updateSettings(venueCode, {
        allowExplicit: explicitMode === 'always',
        explicitAfterHour: explicitMode === 'scheduled' ? explicitAfterHour : null,
        maxSongsPerUser: Math.max(1, Math.min(10, maxSongsPerUser)) || 3,
        genreFilters: genreFilters
          ? genreFilters.split(',').map((g) => g.trim()).filter(Boolean)
          : [],
        requirePaymentForRequest,
        requestPriceCents: Math.max(500, Math.min(5000, requestPriceCents)) || 1000,
        autoplayQueue,
        autoplayGenre: autoplayGenres.length > 0 ? autoplayGenres : null,
        playlistSchedule: playlistSchedule.length > 0 ? playlistSchedule : null,
      });
      onSaved?.();
    } catch (err) {
      console.error(err);
    }
    setSaving(false);
  }

  const isLight = variant === 'light';
  const cardClass = isLight
    ? 'bg-white rounded-xl border border-zinc-200 shadow-sm p-6'
    : 'bg-dark-800 rounded-2xl border border-dark-600 p-6';

  return (
    <div className={cardClass}>
      <h2 className={`text-lg font-bold mb-4 ${isLight ? 'text-zinc-900' : ''}`}>Settings</h2>
      <form onSubmit={handleSubmit} className="space-y-5">
        <div>
          <label className={`block text-sm font-medium mb-2 ${isLight ? 'text-zinc-600' : 'text-dark-400'}`}>
            Explicit content
          </label>
          <div className="flex flex-wrap gap-2 mb-2">
            {[
              { id: 'off', label: 'Never' },
              { id: 'always', label: 'Always' },
              { id: 'scheduled', label: 'After hour' },
            ].map(({ id, label }) => (
              <button
                key={id}
                type="button"
                onClick={() => setExplicitMode(id)}
                className={`px-4 py-2 rounded-full text-xs font-semibold transition-colors min-h-[36px] ${
                  explicitMode === id
                    ? 'bg-brand-500 text-white'
                    : isLight
                      ? 'bg-zinc-100 text-zinc-500 hover:text-zinc-900'
                      : 'bg-dark-700 text-dark-200 hover:text-white'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          {explicitMode === 'scheduled' && (
            <div className="flex items-center gap-2 mt-2">
              <span className={`text-sm ${isLight ? 'text-zinc-600' : 'text-dark-400'}`}>Allow after</span>
              <select
                value={explicitAfterHour}
                onChange={(e) => setExplicitAfterHour(Number(e.target.value))}
                className={`min-h-touch px-3 py-2 rounded-xl focus:ring-2 focus:ring-brand-500 ${
                  isLight ? 'bg-white border border-zinc-300 text-zinc-900' : 'bg-dark-700 border border-dark-600 text-white'
                }`}
              >
                {Array.from({ length: 24 }, (_, i) => (
                  <option key={i} value={i}>{`${i.toString().padStart(2, '0')}:00`}</option>
                ))}
              </select>
            </div>
          )}
          <p className={`text-xs mt-1 ${isLight ? 'text-zinc-400' : 'text-dark-500'}`}>
            {explicitMode === 'off' && 'No explicit songs allowed'}
            {explicitMode === 'always' && 'Explicit songs always allowed'}
            {explicitMode === 'scheduled' && `Clean music before ${explicitAfterHour}:00, explicit after`}
          </p>
        </div>
        <div>
          <label className={`block text-sm font-medium mb-2 ${isLight ? 'text-zinc-600' : 'text-dark-400'}`}>Max songs per user</label>
          <input
            type="number"
            min={1}
            max={10}
            value={maxSongsPerUser}
            onChange={(e) => setMaxSongsPerUser(Number(e.target.value))}
            className={`w-full min-h-touch px-4 py-3 rounded-xl focus:ring-2 focus:ring-brand-500 ${
              isLight ? 'bg-white border border-zinc-300 text-zinc-900' : 'bg-dark-700 border border-dark-600 text-white'
            }`}
          />
        </div>
        <div>
          <label className={`block text-sm font-medium mb-1 ${isLight ? 'text-zinc-600' : 'text-dark-400'}`}>
            Request genre filter
          </label>
          <p className={`text-xs mb-2 ${isLight ? 'text-zinc-400' : 'text-dark-500'}`}>
            Limits what genres customers can search and request. Leave empty to allow all genres.
          </p>
          <input
            type="text"
            value={genreFilters}
            onChange={(e) => setGenreFilters(e.target.value)}
            placeholder="e.g. amapiano, house, hip-hop"
            className={`w-full min-h-touch px-4 py-3 rounded-xl focus:ring-2 focus:ring-brand-500 ${
              isLight ? 'bg-white border border-zinc-300 text-zinc-900 placeholder-zinc-400' : 'bg-dark-700 border border-dark-600 text-white placeholder-dark-500'
            }`}
          />
        </div>
        <div className={`border-t pt-5 space-y-4 ${isLight ? 'border-zinc-200' : 'border-dark-600'}`}>
          <h3 className={`font-semibold ${isLight ? 'text-zinc-900' : ''}`}>Venue Player</h3>
          <label className={`flex items-center gap-3 min-h-touch cursor-pointer ${isLight ? 'text-zinc-700' : ''}`}>
            <input
              type="checkbox"
              checked={autoplayQueue}
              onChange={(e) => setAutoplayQueue(e.target.checked)}
              className="rounded border-dark-500 text-brand-500 focus:ring-brand-500"
            />
            <span>Autoplay queue (auto-advance and play next song)</span>
          </label>
          {autoplayQueue && (
            <div>
              <label className={`block text-sm font-medium mb-1 ${isLight ? 'text-zinc-600' : 'text-dark-400'}`}>
                Autoplay genres
              </label>
              <p className={`text-xs mb-2 ${isLight ? 'text-zinc-400' : 'text-dark-500'}`}>
                Used to pick songs automatically when the queue runs empty. Does not affect what customers can request.
              </p>
              {autoplayGenres.length > 0 && (
                <div className="flex flex-wrap gap-2 mb-3">
                  {autoplayGenres.map((g) => (
                    <span
                      key={g}
                      className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-brand-500 text-white text-sm font-medium cursor-pointer hover:bg-brand-600"
                      onClick={() => toggleGenre(g)}
                    >
                      {g}
                      <span className="text-white/80 text-xs ml-0.5">✕</span>
                    </span>
                  ))}
                </div>
              )}
              {GENRE_SECTIONS.map((section) => (
                <div key={section.label} className="mb-3">
                  <p className={`text-xs font-semibold uppercase tracking-wide mb-2 ${isLight ? 'text-zinc-500' : 'text-dark-400'}`}>
                    {section.label}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {section.items.map((g) => (
                      <button
                        key={g}
                        type="button"
                        onClick={() => toggleGenre(g)}
                        className={`px-3 py-1.5 rounded-full text-sm font-medium border transition-colors ${
                          autoplayGenres.includes(g)
                            ? 'bg-brand-500 text-white border-brand-500'
                            : isLight
                              ? 'bg-zinc-50 text-zinc-700 border-zinc-200 hover:bg-zinc-100'
                              : 'bg-dark-700 text-dark-200 border-dark-500 hover:bg-dark-600'
                        }`}
                      >
                        {g}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
              <p className={`text-xs mt-1 ${isLight ? 'text-zinc-500' : 'text-dark-500'}`}>
                Pick one or more — songs will auto-play from these when nobody requests
              </p>
            </div>
          )}

          {/* Playlist Schedule (Dayparting) */}
          {autoplayQueue && playlists.length >= 1 && (
            <div>
              <label className={`block text-sm font-medium mb-1 ${isLight ? 'text-zinc-600' : 'text-dark-400'}`}>
                Playlist schedule
              </label>
              <p className={`text-xs mb-2 ${isLight ? 'text-zinc-400' : 'text-dark-500'}`}>
                Auto-switch playlists by time (uses minutes + optional days). Leave empty to use the active playlist all
                day. For a visual editor, open <strong>Browse &amp; schedule</strong> from the dashboard.
              </p>
              {playlistSchedule.map((slot, idx) => (
                <div key={idx} className={`flex flex-wrap items-center gap-2 mb-2 p-2 rounded-lg ${isLight ? 'bg-zinc-50' : 'bg-dark-700'}`}>
                  <select
                    value={slot.playlistId}
                    onChange={(e) => {
                      const updated = [...playlistSchedule];
                      updated[idx] = { ...updated[idx], playlistId: e.target.value };
                      setPlaylistSchedule(updated);
                    }}
                    className={`flex-1 min-w-[120px] px-2 py-1.5 rounded-lg text-sm ${
                      isLight ? 'bg-white border border-zinc-300 text-zinc-900' : 'bg-dark-600 border border-dark-500 text-white'
                    }`}
                  >
                    {playlists.map((p) => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                  <select
                    value={slot.startHour}
                    onChange={(e) => {
                      const updated = [...playlistSchedule];
                      updated[idx] = { ...updated[idx], startHour: Number(e.target.value) };
                      setPlaylistSchedule(updated);
                    }}
                    className={`w-20 px-2 py-1.5 rounded-lg text-sm ${
                      isLight ? 'bg-white border border-zinc-300 text-zinc-900' : 'bg-dark-600 border border-dark-500 text-white'
                    }`}
                  >
                    {Array.from({ length: 24 }, (_, i) => (
                      <option key={i} value={i}>{`${i.toString().padStart(2, '0')}:00`}</option>
                    ))}
                  </select>
                  <span className={`text-xs ${isLight ? 'text-zinc-500' : 'text-dark-400'}`}>to</span>
                  <select
                    value={slot.endHour}
                    onChange={(e) => {
                      const updated = [...playlistSchedule];
                      updated[idx] = { ...updated[idx], endHour: Number(e.target.value) };
                      setPlaylistSchedule(updated);
                    }}
                    className={`w-20 px-2 py-1.5 rounded-lg text-sm ${
                      isLight ? 'bg-white border border-zinc-300 text-zinc-900' : 'bg-dark-600 border border-dark-500 text-white'
                    }`}
                  >
                    {Array.from({ length: 24 }, (_, i) => (
                      <option key={i} value={i}>{`${i.toString().padStart(2, '0')}:00`}</option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => setPlaylistSchedule(playlistSchedule.filter((_, i) => i !== idx))}
                    className="text-red-500 hover:text-red-700 text-xs font-bold px-2 py-1"
                  >
                    Remove
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={() => setPlaylistSchedule([...playlistSchedule, { playlistId: playlists[0]?.id || '', startHour: 9, endHour: 17 }])}
                className={`text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors ${
                  isLight ? 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200' : 'bg-dark-700 text-dark-200 hover:bg-dark-600'
                }`}
              >
                + Add time slot
              </button>
            </div>
          )}
        </div>
        <div className={`border-t pt-5 space-y-4 ${isLight ? 'border-zinc-200' : 'border-dark-600'}`}>
          <h3 className={`font-semibold ${isLight ? 'text-zinc-900' : ''}`}>Pay to play</h3>
          <label className={`flex items-center gap-3 min-h-touch cursor-pointer ${isLight ? 'text-zinc-700' : ''}`}>
            <input
              type="checkbox"
              checked={requirePaymentForRequest}
              onChange={(e) => setRequirePaymentForRequest(e.target.checked)}
              className="rounded border-dark-500 text-brand-500 focus:ring-brand-500"
            />
            <span>Require payment to suggest a song</span>
          </label>
          {requirePaymentForRequest && (
            <div>
              <label className={`block text-sm font-medium mb-2 ${isLight ? 'text-zinc-600' : 'text-dark-400'}`}>Price per request (R)</label>
              <input
                type="number"
                min={5}
                max={50}
                value={requestPriceCents / 100}
                onChange={(e) => setRequestPriceCents(Math.round(Number(e.target.value) * 100) || 1000)}
                className={`w-24 min-h-touch px-4 py-3 rounded-xl focus:ring-2 focus:ring-brand-500 ${
                  isLight ? 'bg-white border border-zinc-300 text-zinc-900' : 'bg-dark-700 border border-dark-600 text-white'
                }`}
              />
              <p className="text-xs text-dark-500 mt-1">R5–R50. Add YOCO_SECRET_KEY on the server to enable.</p>
            </div>
          )}
        </div>
        <Button type="submit" disabled={saving} className="w-full">
          {saving ? 'Saving...' : 'Save settings'}
        </Button>
      </form>
    </div>
  );
}
