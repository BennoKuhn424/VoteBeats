import { useState, useEffect, useRef } from 'react';
import { BarChart3, TrendingUp, ThumbsUp, ThumbsDown, Music2, Users, Volume2, ChevronDown } from 'lucide-react';
import api from '../../utils/api';
import socket from '../../utils/socket';

export default function AnalyticsDashboard({ venueCode, variant = 'light' }) {
  const [data, setData] = useState(null);
  const [days, setDays] = useState(7);
  const [loading, setLoading] = useState(true);
  const [votePanel, setVotePanel] = useState(null); // null | 'up' | 'down'
  const daysRef = useRef(days);
  daysRef.current = days;

  const isLight = variant === 'light';

  useEffect(() => {
    if (!venueCode) return;
    let alive = true;

    async function load(silent) {
      const d = daysRef.current;
      if (!silent) setLoading(true);
      try {
        const res = await api.getAnalytics(venueCode, d);
        if (!alive) return;
        setData(res.data);
      } catch (e) {
        console.error(e);
      } finally {
        if (alive && !silent) setLoading(false);
      }
    }

    load(false);

    function joinRoom() {
      socket.emit('join', venueCode);
    }
    socket.connect();
    joinRoom();

    let debounceTimer;
    const scheduleRefetch = () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => load(true), 400);
    };

    socket.on('connect', joinRoom);
    socket.on('queue:updated', scheduleRefetch);
    socket.on('volume:feedback', scheduleRefetch);

    const intervalId = setInterval(() => load(true), 25000);

    return () => {
      alive = false;
      clearTimeout(debounceTimer);
      clearInterval(intervalId);
      socket.off('connect', joinRoom);
      socket.off('queue:updated', scheduleRefetch);
      socket.off('volume:feedback', scheduleRefetch);
    };
  }, [venueCode, days]);

  if (loading && !data) {
    return (
      <div className="flex justify-center py-8">
        <div className="w-8 h-8 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!data) return null;

  const maxHourly = Math.max(...data.hourlyActivity, 1);
  const vf = data.volumeFeedback || {
    total: 0,
    tooLoud: 0,
    tooSoft: 0,
    unknownVolume: 0,
    tooLoudByVolumeBin: Array(10).fill(0),
    tooSoftByVolumeBin: Array(10).fill(0),
    binLabels: [],
  };
  const hasVolumeAnalytics = vf.total > 0;
  const maxVolBin = Math.max(
    1,
    ...vf.tooLoudByVolumeBin,
    ...vf.tooSoftByVolumeBin
  );

  const votesUpBySong = data.votesUpBySong || [];
  const votesDownBySong = data.votesDownBySong || [];

  return (
    <div className="space-y-6">
      {/* Period selector */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <h3 className={`font-semibold ${isLight ? 'text-zinc-900' : 'text-white'}`}>
            Analytics
          </h3>
          {loading && data && (
            <span className={`text-xs ${isLight ? 'text-zinc-400' : 'text-dark-500'}`}>Updating…</span>
          )}
        </div>
        <div className="flex gap-1">
          {[1, 7, 14, 30].map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => setDays(d)}
              className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-colors ${
                days === d
                  ? 'bg-brand-500 text-white'
                  : isLight
                    ? 'bg-zinc-100 text-zinc-500 hover:text-zinc-900'
                    : 'bg-dark-700 text-dark-200 hover:text-white'
              }`}
            >
              {d === 1 ? '24h' : `${d}d`}
            </button>
          ))}
        </div>
      </div>

      {/* Stats cards — upvotes/downvotes open detail lists */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div
          className={`p-3 rounded-xl ${
            isLight ? 'bg-zinc-50 border border-zinc-200' : 'bg-dark-700 border border-dark-600'
          }`}
        >
          <div className="flex items-center gap-2 mb-1">
            <Music2 className="h-4 w-4 text-blue-500" />
            <span className={`text-xs font-medium ${isLight ? 'text-zinc-500' : 'text-dark-400'}`}>Requests</span>
          </div>
          <p className={`text-xl font-bold ${isLight ? 'text-zinc-900' : 'text-white'}`}>{data.totalRequests}</p>
        </div>

        <div
          className={`p-3 rounded-xl ${
            isLight ? 'bg-zinc-50 border border-zinc-200' : 'bg-dark-700 border border-dark-600'
          }`}
        >
          <div className="flex items-center gap-2 mb-1">
            <Users className="h-4 w-4 text-purple-500" />
            <span className={`text-xs font-medium ${isLight ? 'text-zinc-500' : 'text-dark-400'}`}>Votes</span>
          </div>
          <p className={`text-xl font-bold ${isLight ? 'text-zinc-900' : 'text-white'}`}>{data.totalVotes}</p>
        </div>

        <button
          type="button"
          onClick={() => setVotePanel((p) => (p === 'up' ? null : 'up'))}
          className={`p-3 rounded-xl text-left transition-colors ${
            isLight
              ? `border ${votePanel === 'up' ? 'border-green-400 bg-green-50' : 'border-zinc-200 bg-zinc-50 hover:bg-zinc-100'}`
              : `border ${votePanel === 'up' ? 'border-green-500/50 bg-dark-600' : 'border-dark-600 bg-dark-700 hover:bg-dark-600/80'}`
          }`}
        >
          <div className="flex items-center gap-2 mb-1">
            <ThumbsUp className="h-4 w-4 text-green-500" />
            <span className={`text-xs font-medium ${isLight ? 'text-zinc-500' : 'text-dark-400'}`}>Upvotes</span>
            <ChevronDown
              className={`h-3 w-3 ml-auto shrink-0 ${isLight ? 'text-zinc-400' : 'text-dark-500'} ${
                votePanel === 'up' ? 'rotate-180' : ''
              }`}
            />
          </div>
          <p className={`text-xl font-bold ${isLight ? 'text-zinc-900' : 'text-white'}`}>{data.upvotes}</p>
          <p className={`text-[10px] mt-1 ${isLight ? 'text-zinc-500' : 'text-dark-500'}`}>Tap for songs</p>
        </button>

        <button
          type="button"
          onClick={() => setVotePanel((p) => (p === 'down' ? null : 'down'))}
          className={`p-3 rounded-xl text-left transition-colors ${
            isLight
              ? `border ${votePanel === 'down' ? 'border-red-400 bg-red-50' : 'border-zinc-200 bg-zinc-50 hover:bg-zinc-100'}`
              : `border ${votePanel === 'down' ? 'border-red-500/50 bg-dark-600' : 'border-dark-600 bg-dark-700 hover:bg-dark-600/80'}`
          }`}
        >
          <div className="flex items-center gap-2 mb-1">
            <ThumbsDown className="h-4 w-4 text-red-500" />
            <span className={`text-xs font-medium ${isLight ? 'text-zinc-500' : 'text-dark-400'}`}>Downvotes</span>
            <ChevronDown
              className={`h-3 w-3 ml-auto shrink-0 ${isLight ? 'text-zinc-400' : 'text-dark-500'} ${
                votePanel === 'down' ? 'rotate-180' : ''
              }`}
            />
          </div>
          <p className={`text-xl font-bold ${isLight ? 'text-zinc-900' : 'text-white'}`}>{data.downvotes}</p>
          <p className={`text-[10px] mt-1 ${isLight ? 'text-zinc-500' : 'text-dark-500'}`}>Tap for songs</p>
        </button>
      </div>

      {votePanel && (
        <div
          className={`rounded-xl border p-4 ${
            isLight ? 'bg-white border-zinc-200' : 'bg-dark-800 border-dark-600'
          }`}
        >
          <h4 className={`text-sm font-semibold mb-2 ${isLight ? 'text-zinc-800' : 'text-white'}`}>
            {votePanel === 'up' ? 'Songs that received upvotes' : 'Songs that received downvotes'}
          </h4>
          <p className={`text-xs mb-3 ${isLight ? 'text-zinc-500' : 'text-dark-400'}`}>
            Each row is how many upvote/downvote actions were recorded for that track in this period (not unique
            guests).
          </p>
          {(votePanel === 'up' ? votesUpBySong : votesDownBySong).length === 0 ? (
            <p className={`text-sm ${isLight ? 'text-zinc-400' : 'text-dark-500'}`}>
              No {votePanel === 'up' ? 'upvotes' : 'downvotes'} in this period yet.
            </p>
          ) : (
            <ul className="space-y-2 max-h-56 overflow-y-auto">
              {(votePanel === 'up' ? votesUpBySong : votesDownBySong).map((row, i) => (
                <li key={i} className="flex items-center gap-2 text-sm">
                  <span className={`w-6 text-right text-xs font-bold ${isLight ? 'text-zinc-400' : 'text-dark-500'}`}>
                    {i + 1}
                  </span>
                  <span className={`flex-1 truncate ${isLight ? 'text-zinc-700' : 'text-dark-200'}`}>{row.name}</span>
                  <span
                    className={`text-xs font-semibold px-2 py-0.5 rounded-full shrink-0 ${
                      votePanel === 'up'
                        ? isLight
                          ? 'bg-green-100 text-green-700'
                          : 'bg-green-500/20 text-green-300'
                        : isLight
                          ? 'bg-red-100 text-red-700'
                          : 'bg-red-500/20 text-red-300'
                    }`}
                  >
                    {row.count}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Volume feedback — always show; empty state when no data */}
      <div className={`p-4 rounded-xl ${isLight ? 'bg-zinc-50 border border-zinc-200' : 'bg-dark-700 border border-dark-600'}`}>
        <div className="flex items-center gap-2 mb-2">
          <Volume2 className={`h-4 w-4 ${isLight ? 'text-zinc-500' : 'text-dark-400'}`} />
          <span className={`text-sm font-medium ${isLight ? 'text-zinc-600' : 'text-dark-300'}`}>
            Volume suggestions
          </span>
        </div>
        <p className={`text-xs mb-3 ${isLight ? 'text-zinc-500' : 'text-dark-500'}`}>
          When guests tap &quot;too loud&quot; or &quot;too quiet&quot;, we store the venue player&apos;s volume
          slider (0–100%). Charts refresh automatically when guests send feedback.
        </p>
        {!hasVolumeAnalytics ? (
          <p className={`text-sm py-4 text-center ${isLight ? 'text-zinc-400' : 'text-dark-500'}`}>
            No volume feedback in this period yet.
          </p>
        ) : (
          <>
            <div className="flex flex-wrap gap-3 mb-3 text-xs">
              <span className={`font-semibold ${isLight ? 'text-amber-700' : 'text-amber-300'}`}>
                Too loud: {vf.tooLoud}
              </span>
              <span className={`font-semibold ${isLight ? 'text-sky-700' : 'text-sky-300'}`}>
                Too quiet: {vf.tooSoft}
              </span>
              {vf.unknownVolume > 0 && (
                <span className={isLight ? 'text-zinc-500' : 'text-dark-500'}>
                  Unknown level: {vf.unknownVolume}
                </span>
              )}
            </div>
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-[10px] uppercase tracking-wide">
                <span className="w-3 h-3 rounded-sm bg-amber-500/80" />
                <span className={isLight ? 'text-zinc-500' : 'text-dark-500'}>Too loud by player volume</span>
              </div>
              <div className="flex items-end gap-px h-16">
                {vf.tooLoudByVolumeBin.map((count, i) => (
                  <div key={`l-${i}`} className="flex-1 flex flex-col items-center gap-0.5">
                    <div
                      className="w-full bg-amber-500/90 rounded-t-sm min-h-[2px]"
                      style={{ height: `${(count / maxVolBin) * 100}%` }}
                      title={`${vf.binLabels[i]} — ${count}`}
                    />
                  </div>
                ))}
              </div>
              <div className="flex items-center gap-2 text-[10px] uppercase tracking-wide mt-2">
                <span className="w-3 h-3 rounded-sm bg-sky-500/80" />
                <span className={isLight ? 'text-zinc-500' : 'text-dark-500'}>Too quiet by player volume</span>
              </div>
              <div className="flex items-end gap-px h-16">
                {vf.tooSoftByVolumeBin.map((count, i) => (
                  <div key={`s-${i}`} className="flex-1 flex flex-col items-center gap-0.5">
                    <div
                      className="w-full bg-sky-500/90 rounded-t-sm min-h-[2px]"
                      style={{ height: `${(count / maxVolBin) * 100}%` }}
                      title={`${vf.binLabels[i]} — ${count}`}
                    />
                  </div>
                ))}
              </div>
              <div className="flex justify-between mt-1">
                <span className={`text-[10px] ${isLight ? 'text-zinc-400' : 'text-dark-500'}`}>0%</span>
                <span className={`text-[10px] ${isLight ? 'text-zinc-400' : 'text-dark-500'}`}>50%</span>
                <span className={`text-[10px] ${isLight ? 'text-zinc-400' : 'text-dark-500'}`}>100%</span>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Hourly activity chart */}
      <div className={`p-4 rounded-xl ${isLight ? 'bg-zinc-50 border border-zinc-200' : 'bg-dark-700 border border-dark-600'}`}>
        <div className="flex items-center gap-2 mb-3">
          <BarChart3 className={`h-4 w-4 ${isLight ? 'text-zinc-500' : 'text-dark-400'}`} />
          <span className={`text-sm font-medium ${isLight ? 'text-zinc-600' : 'text-dark-300'}`}>Activity by hour</span>
        </div>
        <div className="flex items-end gap-[2px] h-20">
          {data.hourlyActivity.map((count, hour) => (
            <div key={hour} className="flex-1 flex flex-col items-center gap-1">
              <div
                className="w-full bg-brand-500 rounded-t-sm transition-all min-h-[2px]"
                style={{ height: `${(count / maxHourly) * 100}%` }}
                title={`${hour}:00 — ${count} events`}
              />
            </div>
          ))}
        </div>
        <div className="flex justify-between mt-1">
          <span className={`text-[10px] ${isLight ? 'text-zinc-400' : 'text-dark-500'}`}>00:00</span>
          <span className={`text-[10px] ${isLight ? 'text-zinc-400' : 'text-dark-500'}`}>12:00</span>
          <span className={`text-[10px] ${isLight ? 'text-zinc-400' : 'text-dark-500'}`}>23:00</span>
        </div>
      </div>

      {/* Top songs & artists */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className={`p-4 rounded-xl ${isLight ? 'bg-zinc-50 border border-zinc-200' : 'bg-dark-700 border border-dark-600'}`}>
          <div className="flex items-center gap-2 mb-3">
            <TrendingUp className={`h-4 w-4 ${isLight ? 'text-zinc-500' : 'text-dark-400'}`} />
            <span className={`text-sm font-medium ${isLight ? 'text-zinc-600' : 'text-dark-300'}`}>Top requested songs</span>
          </div>
          {data.topSongs.length === 0 ? (
            <p className={`text-sm ${isLight ? 'text-zinc-400' : 'text-dark-500'}`}>No requests yet</p>
          ) : (
            <div className="space-y-2 max-h-48 overflow-y-auto">
              {data.topSongs.map((song, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className={`text-xs font-bold w-5 text-right ${isLight ? 'text-zinc-400' : 'text-dark-500'}`}>{i + 1}</span>
                  <span className={`flex-1 text-sm truncate ${isLight ? 'text-zinc-700' : 'text-dark-200'}`}>{song.name}</span>
                  <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${isLight ? 'bg-brand-50 text-brand-600' : 'bg-brand-500/20 text-brand-300'}`}>
                    {song.count}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className={`p-4 rounded-xl ${isLight ? 'bg-zinc-50 border border-zinc-200' : 'bg-dark-700 border border-dark-600'}`}>
          <div className="flex items-center gap-2 mb-3">
            <Users className={`h-4 w-4 ${isLight ? 'text-zinc-500' : 'text-dark-400'}`} />
            <span className={`text-sm font-medium ${isLight ? 'text-zinc-600' : 'text-dark-300'}`}>Top artists</span>
          </div>
          {data.topArtists.length === 0 ? (
            <p className={`text-sm ${isLight ? 'text-zinc-400' : 'text-dark-500'}`}>No requests yet</p>
          ) : (
            <div className="space-y-2 max-h-48 overflow-y-auto">
              {data.topArtists.map((artist, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className={`text-xs font-bold w-5 text-right ${isLight ? 'text-zinc-400' : 'text-dark-500'}`}>{i + 1}</span>
                  <span className={`flex-1 text-sm truncate ${isLight ? 'text-zinc-700' : 'text-dark-200'}`}>{artist.name}</span>
                  <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${isLight ? 'bg-purple-50 text-purple-600' : 'bg-purple-500/20 text-purple-300'}`}>
                    {artist.count}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
