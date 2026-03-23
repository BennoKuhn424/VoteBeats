import { useState, useEffect } from 'react';
import { BarChart3, TrendingUp, ThumbsUp, ThumbsDown, Music2, Users, Volume2 } from 'lucide-react';
import api from '../../utils/api';

export default function AnalyticsDashboard({ venueCode, variant = 'light' }) {
  const [data, setData] = useState(null);
  const [days, setDays] = useState(7);
  const [loading, setLoading] = useState(true);

  const isLight = variant === 'light';

  useEffect(() => {
    if (!venueCode) return;
    setLoading(true);
    api.getAnalytics(venueCode, days)
      .then((res) => setData(res.data))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [venueCode, days]);

  if (loading) {
    return (
      <div className="flex justify-center py-8">
        <div className="w-8 h-8 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!data) return null;

  const maxHourly = Math.max(...data.hourlyActivity, 1);
  const vf = data.volumeFeedback;
  const hasVolumeAnalytics = vf && vf.total > 0;
  const maxVolBin = hasVolumeAnalytics
    ? Math.max(
        1,
        ...vf.tooLoudByVolumeBin,
        ...vf.tooSoftByVolumeBin
      )
    : 1;

  return (
    <div className="space-y-6">
      {/* Period selector */}
      <div className="flex items-center justify-between">
        <h3 className={`font-semibold ${isLight ? 'text-zinc-900' : 'text-white'}`}>
          Analytics
        </h3>
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

      {/* Stats cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Requests', value: data.totalRequests, Icon: Music2, color: 'blue' },
          { label: 'Votes', value: data.totalVotes, Icon: Users, color: 'purple' },
          { label: 'Upvotes', value: data.upvotes, Icon: ThumbsUp, color: 'green' },
          { label: 'Downvotes', value: data.downvotes, Icon: ThumbsDown, color: 'red' },
        ].map(({ label, value, Icon, color }) => (
          <div
            key={label}
            className={`p-3 rounded-xl ${
              isLight ? 'bg-zinc-50 border border-zinc-200' : 'bg-dark-700 border border-dark-600'
            }`}
          >
            <div className="flex items-center gap-2 mb-1">
              <Icon className={`h-4 w-4 text-${color}-500`} />
              <span className={`text-xs font-medium ${isLight ? 'text-zinc-500' : 'text-dark-400'}`}>{label}</span>
            </div>
            <p className={`text-xl font-bold ${isLight ? 'text-zinc-900' : 'text-white'}`}>{value}</p>
          </div>
        ))}
      </div>

      {/* Volume feedback — correlated with venue player slider % */}
      {hasVolumeAnalytics && (
        <div className={`p-4 rounded-xl ${isLight ? 'bg-zinc-50 border border-zinc-200' : 'bg-dark-700 border border-dark-600'}`}>
          <div className="flex items-center gap-2 mb-2">
            <Volume2 className={`h-4 w-4 ${isLight ? 'text-zinc-500' : 'text-dark-400'}`} />
            <span className={`text-sm font-medium ${isLight ? 'text-zinc-600' : 'text-dark-300'}`}>
              Volume suggestions
            </span>
          </div>
          <p className={`text-xs mb-3 ${isLight ? 'text-zinc-500' : 'text-dark-500'}`}>
            When guests tap &quot;too loud&quot; or &quot;too quiet&quot;, we store the venue player&apos;s volume
            slider (0–100%). Use this to see which levels get the most complaints.
          </p>
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
        </div>
      )}

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
        {/* Top songs */}
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

        {/* Top artists */}
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
