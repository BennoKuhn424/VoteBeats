import { useState, useEffect, useRef } from 'react';
import { TrendingUp, ThumbsUp, ThumbsDown, Music2, Users, Volume2, ChevronDown, Clock, Sparkles } from 'lucide-react';
import api from '../../utils/api';
import socket from '../../utils/socket';

function formatHour12(h) {
  if (h === 0) return '12 AM';
  if (h < 12) return `${h} AM`;
  if (h === 12) return '12 PM';
  return `${h - 12} PM`;
}

/** Hourly vertical bars with grid, peak insight, labeled axis */
function HourlyActivityChart({ hourlyActivity, isLight }) {
  const max = Math.max(...hourlyActivity, 1);
  const total = hourlyActivity.reduce((a, b) => a + b, 0);
  const peakHour = hourlyActivity.indexOf(max);
  const ticks = [0, 6, 12, 18];

  return (
    <div
      className={`rounded-2xl border overflow-hidden ${
        isLight ? 'bg-white dark:bg-dark-800 border-zinc-200 dark:border-dark-600 shadow-sm' : 'bg-dark-800/80 border-dark-600'
      }`}
    >
      <div className={`px-4 pt-4 pb-2 border-b ${isLight ? 'border-zinc-100 dark:border-dark-600 bg-zinc-50/80 dark:bg-dark-900/50' : 'border-dark-600 bg-dark-900/50'}`}>
        <div className="flex items-start gap-3">
          <div className={`p-2 rounded-xl ${isLight ? 'bg-brand-100 dark:bg-brand-500/20 text-brand-600 dark:text-brand-300' : 'bg-brand-500/20 text-brand-300'}`}>
            <Clock className="h-5 w-5" />
          </div>
          <div>
            <h4 className={`text-sm font-bold ${isLight ? 'text-zinc-900 dark:text-zinc-100' : 'text-white'}`}>When are people most active?</h4>
            <p className={`text-xs mt-0.5 ${isLight ? 'text-zinc-500 dark:text-zinc-400' : 'text-dark-400'}`}>
              All events in this period (requests, votes, volume feedback) grouped by hour of day.
            </p>
            {total > 0 && (
              <p className={`text-xs mt-2 font-medium flex items-center gap-1.5 ${isLight ? 'text-brand-700 dark:text-brand-300' : 'text-brand-300'}`}>
                <Sparkles className="h-3.5 w-3.5 shrink-0" />
                Busiest time: <strong>{formatHour12(peakHour)}</strong> — {max} event{max !== 1 ? 's' : ''} · {total} total
              </p>
            )}
          </div>
        </div>
      </div>

      <div className="p-4">
        {total === 0 ? (
          <p className={`text-sm text-center py-8 ${isLight ? 'text-zinc-400 dark:text-zinc-500' : 'text-dark-500'}`}>
            No activity in this period yet.
          </p>
        ) : (
          <>
            <div className="flex gap-2">
              {/* Y-axis labels */}
              <div className={`flex flex-col justify-between text-[10px] font-medium w-7 shrink-0 h-52 pb-6 ${isLight ? 'text-zinc-400 dark:text-zinc-500' : 'text-dark-500'}`}>
                <span>{max}</span>
                <span>{Math.round(max / 2)}</span>
                <span>0</span>
              </div>
              <div className="flex-1 min-w-0">
                <div className={`relative h-52 border-l border-b rounded-bl ${isLight ? 'border-zinc-200 dark:border-dark-600' : 'border-dark-600'}`}>
                  {/* faint horizontal grid */}
                  <div className="absolute inset-0 flex flex-col justify-between pointer-events-none pb-6 pl-0">
                    <div className={`border-t border-dashed ${isLight ? 'border-zinc-100 dark:border-dark-700' : 'border-dark-700'}`} />
                    <div className={`border-t border-dashed ${isLight ? 'border-zinc-100 dark:border-dark-700' : 'border-dark-700'}`} />
                    <div className="h-0" />
                  </div>
                  <div className="absolute inset-0 flex items-end gap-0.5 sm:gap-1 pl-1 pr-1 pb-6">
                    {hourlyActivity.map((count, hour) => {
                      const pct = (count / max) * 100;
                      const h = Math.max(pct, count > 0 ? 8 : 2);
                      return (
                        <div key={hour} className="flex-1 flex flex-col justify-end items-center min-w-0 group relative">
                          <div
                            className={`w-full max-w-[14px] mx-auto rounded-t-md transition-all ${
                              hour === peakHour && count > 0
                                ? isLight
                                  ? 'bg-gradient-to-t from-violet-600 to-violet-400 dark:from-violet-500 dark:to-violet-300 shadow-md dark:shadow-lg ring-2 ring-violet-300/50 dark:ring-violet-400/30'
                                  : 'bg-gradient-to-t from-violet-500 to-violet-300 shadow-lg ring-2 ring-violet-400/30'
                                : isLight
                                  ? 'bg-gradient-to-t from-brand-600 to-brand-400 dark:from-brand-500 dark:to-brand-400'
                                  : 'bg-gradient-to-t from-brand-500 to-brand-400'
                            }`}
                            style={{ height: `${h}%` }}
                            title={`${formatHour12(hour)}: ${count} event${count !== 1 ? 's' : ''}`}
                          />
                        </div>
                      );
                    })}
                  </div>
                </div>
                <div className="flex justify-between mt-1 pl-1 pr-0 text-[10px] font-medium">
                  {ticks.map((h) => (
                    <span key={h} className={isLight ? 'text-zinc-500 dark:text-zinc-400' : 'text-dark-500'}>
                      {formatHour12(h)}
                    </span>
                  ))}
                  <span className={isLight ? 'text-zinc-500 dark:text-zinc-400' : 'text-dark-500'}>11 PM</span>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/** One row per volume band — horizontal bars + counts */
function VolumeLevelChart({ vf, maxVolBin, isLight }) {
  const labels = vf.binLabels?.length ? vf.binLabels : ['0–9%', '10–19%', '20–29%', '30–39%', '40–49%', '50–59%', '60–69%', '70–79%', '80–89%', '90–100%'];

  let topLoudIdx = 0;
  let topLoudVal = 0;
  vf.tooLoudByVolumeBin.forEach((c, i) => {
    if (c > topLoudVal) {
      topLoudVal = c;
      topLoudIdx = i;
    }
  });
  let topSoftIdx = 0;
  let topSoftVal = 0;
  vf.tooSoftByVolumeBin.forEach((c, i) => {
    if (c > topSoftVal) {
      topSoftVal = c;
      topSoftIdx = i;
    }
  });

  return (
    <div
      className={`rounded-2xl border overflow-hidden ${
        isLight ? 'bg-white dark:bg-dark-800 border-zinc-200 dark:border-dark-600 shadow-sm' : 'bg-dark-800/80 border-dark-600'
      }`}
    >
      <div className={`px-4 pt-4 pb-2 border-b ${isLight ? 'border-zinc-100 dark:border-dark-600 bg-zinc-50/80 dark:bg-dark-900/50' : 'border-dark-600 bg-dark-900/50'}`}>
        <div className="flex items-start gap-3">
          <div className={`p-2 rounded-xl ${isLight ? 'bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-300' : 'bg-amber-500/20 text-amber-300'}`}>
            <Volume2 className="h-5 w-5" />
          </div>
          <div>
            <h4 className={`text-sm font-bold ${isLight ? 'text-zinc-900 dark:text-zinc-100' : 'text-white'}`}>Volume feedback vs player level</h4>
            <p className={`text-xs mt-0.5 ${isLight ? 'text-zinc-500 dark:text-zinc-400' : 'text-dark-400'}`}>
              Each row is a volume range on the venue player (0–100%). Orange = guests said <strong>too loud</strong>, blue
              = <strong>too quiet</strong>. Bar length shows how many feedbacks happened at that level.
            </p>
            {(topLoudVal > 0 || topSoftVal > 0) && (
              <p className={`text-xs mt-2 ${isLight ? 'text-zinc-600 dark:text-zinc-300' : 'text-dark-300'}`}>
                {topLoudVal > 0 && (
                  <>
                    Most &quot;too loud&quot; at <strong>{labels[topLoudIdx]}</strong> ({topLoudVal})
                    {topSoftVal > 0 ? ' · ' : ''}
                  </>
                )}
                {topSoftVal > 0 && (
                  <>
                    Most &quot;too quiet&quot; at <strong>{labels[topSoftIdx]}</strong> ({topSoftVal})
                  </>
                )}
              </p>
            )}
          </div>
        </div>
        <div className="flex flex-wrap gap-4 mt-3 text-xs">
          <span className={`flex items-center gap-2 font-medium ${isLight ? 'text-amber-800 dark:text-amber-300' : 'text-amber-300'}`}>
            <span className="w-3 h-3 rounded bg-gradient-to-r from-amber-500 to-orange-400" />
            Too loud ({vf.tooLoud})
          </span>
          <span className={`flex items-center gap-2 font-medium ${isLight ? 'text-sky-800 dark:text-sky-300' : 'text-sky-300'}`}>
            <span className="w-3 h-3 rounded bg-gradient-to-r from-sky-500 to-cyan-400" />
            Too quiet ({vf.tooSoft})
          </span>
          {vf.unknownVolume > 0 && (
            <span className={isLight ? 'text-zinc-500 dark:text-zinc-400' : 'text-dark-500'}>Unknown slider level: {vf.unknownVolume}</span>
          )}
        </div>
      </div>

      <div className="p-3 sm:p-4 space-y-2 max-h-[min(70vh,28rem)] overflow-y-auto">
        {labels.map((label, i) => {
          const loud = vf.tooLoudByVolumeBin[i] || 0;
          const soft = vf.tooSoftByVolumeBin[i] || 0;
          if (loud === 0 && soft === 0) return null;
          const wLoud = maxVolBin ? (loud / maxVolBin) * 100 : 0;
          const wSoft = maxVolBin ? (soft / maxVolBin) * 100 : 0;
          return (
            <div key={i} className="grid grid-cols-[3.5rem_1fr] sm:grid-cols-[4.5rem_1fr] gap-x-2 gap-y-1.5 items-center">
              <span className={`text-[11px] sm:text-xs font-semibold ${isLight ? 'text-zinc-600 dark:text-zinc-300' : 'text-dark-300'}`}>
                {label}
              </span>
              <div className="space-y-1.5 min-w-0">
                <div className="flex items-center gap-2">
                  <span className={`text-[10px] w-14 shrink-0 ${isLight ? 'text-amber-700 dark:text-amber-400' : 'text-amber-400'}`}>Too loud</span>
                  <div className={`flex-1 h-6 rounded-lg overflow-hidden ${isLight ? 'bg-amber-50 dark:bg-dark-900' : 'bg-dark-900'}`}>
                    <div
                      className="h-full rounded-lg bg-gradient-to-r from-amber-500 to-orange-400 flex items-center justify-end pr-2 min-w-[20px]"
                      style={{ width: `${Math.max(wLoud, loud > 0 ? 12 : 0)}%` }}
                      title={`Too loud at ${label}: ${loud}`}
                    >
                      {loud > 0 && <span className="text-[11px] font-bold text-white drop-shadow-sm">{loud}</span>}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`text-[10px] w-14 shrink-0 ${isLight ? 'text-sky-700 dark:text-sky-400' : 'text-sky-400'}`}>Too quiet</span>
                  <div className={`flex-1 h-6 rounded-lg overflow-hidden ${isLight ? 'bg-sky-50 dark:bg-dark-900' : 'bg-dark-900'}`}>
                    <div
                      className="h-full rounded-lg bg-gradient-to-r from-sky-500 to-cyan-400 flex items-center justify-end pr-2 min-w-[20px]"
                      style={{ width: `${Math.max(wSoft, soft > 0 ? 12 : 0)}%` }}
                      title={`Too quiet at ${label}: ${soft}`}
                    >
                      {soft > 0 && <span className="text-[11px] font-bold text-white drop-shadow-sm">{soft}</span>}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
        {!labels.some(
          (_, i) => (vf.tooLoudByVolumeBin[i] || 0) + (vf.tooSoftByVolumeBin[i] || 0) > 0
        ) && (
          <p className={`text-sm text-center py-4 ${isLight ? 'text-zinc-400 dark:text-zinc-500' : 'text-dark-500'}`}>
            Feedback was recorded but without a volume level (venue player may have been offline). Open the venue player
            so the slider syncs.
          </p>
        )}
      </div>
    </div>
  );
}

/** Ranked list with proportional bar */
function RankedBarList({ title, icon: Icon, rows, isLight, accent }) {
  const max = rows[0]?.count || 1;
  const acc =
    accent === 'brand'
      ? { bar: isLight ? 'bg-brand-500 dark:bg-brand-400' : 'bg-brand-400', track: isLight ? 'bg-zinc-100 dark:bg-dark-900' : 'bg-dark-900' }
      : { bar: isLight ? 'bg-purple-500 dark:bg-purple-400' : 'bg-purple-400', track: isLight ? 'bg-zinc-100 dark:bg-dark-900' : 'bg-dark-900' };

  return (
    <div
      className={`rounded-2xl border overflow-hidden h-full flex flex-col ${
        isLight ? 'bg-white dark:bg-dark-800 border-zinc-200 dark:border-dark-600 shadow-sm' : 'bg-dark-800/80 border-dark-600'
      }`}
    >
      <div className={`px-4 py-3 border-b ${isLight ? 'border-zinc-100 dark:border-dark-600 bg-zinc-50/80 dark:bg-dark-900/50' : 'border-dark-600 bg-dark-900/50'}`}>
        <div className="flex items-center gap-2">
          <Icon className={`h-4 w-4 ${isLight ? 'text-zinc-500 dark:text-zinc-400' : 'text-dark-400'}`} />
          <h4 className={`text-sm font-bold ${isLight ? 'text-zinc-900 dark:text-zinc-100' : 'text-white'}`}>{title}</h4>
        </div>
        <p className={`text-xs mt-1 ${isLight ? 'text-zinc-500 dark:text-zinc-400' : 'text-dark-400'}`}>
          Bar length = share of the top item. Number = times requested in this period.
        </p>
      </div>
      <div className="p-3 flex-1 overflow-y-auto max-h-64">
        {rows.length === 0 ? (
          <p className={`text-sm py-6 text-center ${isLight ? 'text-zinc-400 dark:text-zinc-500' : 'text-dark-500'}`}>No data yet</p>
        ) : (
          <ul className="space-y-3">
            {rows.map((row, i) => (
              <li key={i}>
                <div className="flex items-center gap-2 mb-1">
                  <span className={`text-xs font-bold w-5 text-right shrink-0 ${isLight ? 'text-zinc-400 dark:text-zinc-500' : 'text-dark-500'}`}>
                    {i + 1}
                  </span>
                  <span className={`flex-1 text-xs sm:text-sm font-medium truncate ${isLight ? 'text-zinc-800 dark:text-zinc-100' : 'text-zinc-100'}`}>
                    {row.name}
                  </span>
                  <span className={`text-xs font-bold tabular-nums shrink-0 ${isLight ? 'text-zinc-600 dark:text-zinc-300' : 'text-dark-300'}`}>
                    {row.count}
                  </span>
                </div>
                <div className={`ml-7 h-2 rounded-full overflow-hidden ${acc.track}`}>
                  <div
                    className={`h-full rounded-full ${acc.bar} transition-all duration-500`}
                    style={{ width: `${Math.max((row.count / max) * 100, row.count > 0 ? 4 : 0)}%` }}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export default function AnalyticsDashboard({ venueCode, variant = 'light' }) {
  const [data, setData] = useState(null);
  const [days, setDays] = useState(7);
  const [loading, setLoading] = useState(true);
  const [votePanel, setVotePanel] = useState(null);
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
  const maxVolBin = Math.max(1, ...vf.tooLoudByVolumeBin, ...vf.tooSoftByVolumeBin);

  const votesUpBySong = data.votesUpBySong || [];
  const votesDownBySong = data.votesDownBySong || [];

  const engagement = data.totalRequests + data.totalVotes + (vf.total || 0);

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <h3 className={`text-lg font-bold ${isLight ? 'text-zinc-900 dark:text-zinc-100' : 'text-white'}`}>Analytics</h3>
          {loading && data && (
            <span className={`text-xs ${isLight ? 'text-zinc-400 dark:text-zinc-500' : 'text-dark-500'}`}>Updating…</span>
          )}
        </div>
        <div
          className={`flex gap-1 p-1 rounded-xl ${
            isLight ? 'bg-zinc-100 dark:bg-dark-900 dark:border dark:border-dark-600' : 'bg-dark-900 border border-dark-600'
          }`}
        >
          {[1, 7, 14, 30].map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => setDays(d)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                days === d
                  ? isLight
                    ? 'bg-white dark:bg-dark-600 text-brand-600 dark:text-brand-300 shadow-sm'
                    : 'bg-dark-600 text-brand-300 shadow-sm'
                  : isLight
                    ? 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white'
                    : 'text-dark-400 hover:text-white'
              }`}
            >
              {d === 1 ? '24h' : `${d}d`}
            </button>
          ))}
        </div>
      </div>

      <p className={`text-sm -mt-4 ${isLight ? 'text-zinc-500 dark:text-zinc-400' : 'text-dark-400'}`}>
        <strong className={isLight ? 'text-zinc-700 dark:text-zinc-200' : 'text-dark-200'}>{engagement}</strong> total interactions in this
        window (requests + votes + volume feedback).
      </p>

      {/* KPI cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className={`p-4 rounded-2xl border ${isLight ? 'bg-white dark:bg-dark-800 border-zinc-200 dark:border-dark-600 shadow-sm' : 'bg-dark-800 border-dark-600'}`}>
          <div className="flex items-center gap-2 mb-2">
            <Music2 className="h-4 w-4 text-blue-500" />
            <span className={`text-xs font-semibold uppercase tracking-wide ${isLight ? 'text-zinc-500 dark:text-zinc-400' : 'text-dark-400'}`}>
              Requests
            </span>
          </div>
          <p className={`text-2xl font-bold tabular-nums ${isLight ? 'text-zinc-900 dark:text-zinc-100' : 'text-white'}`}>{data.totalRequests}</p>
          <p className={`text-[11px] mt-1 ${isLight ? 'text-zinc-400 dark:text-zinc-500' : 'text-dark-500'}`}>Songs added to queue</p>
        </div>

        <div className={`p-4 rounded-2xl border ${isLight ? 'bg-white dark:bg-dark-800 border-zinc-200 dark:border-dark-600 shadow-sm' : 'bg-dark-800 border-dark-600'}`}>
          <div className="flex items-center gap-2 mb-2">
            <Users className="h-4 w-4 text-purple-500" />
            <span className={`text-xs font-semibold uppercase tracking-wide ${isLight ? 'text-zinc-500 dark:text-zinc-400' : 'text-dark-400'}`}>
              Vote taps
            </span>
          </div>
          <p className={`text-2xl font-bold tabular-nums ${isLight ? 'text-zinc-900 dark:text-zinc-100' : 'text-white'}`}>{data.totalVotes}</p>
          <p className={`text-[11px] mt-1 ${isLight ? 'text-zinc-400 dark:text-zinc-500' : 'text-dark-500'}`}>Up + down actions</p>
        </div>

        <button
          type="button"
          onClick={() => setVotePanel((p) => (p === 'up' ? null : 'up'))}
          className={`p-4 rounded-2xl border text-left transition-all ${
            isLight
              ? `shadow-sm ${votePanel === 'up' ? 'border-green-400 dark:border-green-500/50 bg-green-50 dark:bg-dark-700 ring-2 ring-green-200 dark:ring-green-500/20' : 'border-zinc-200 dark:border-dark-600 bg-white dark:bg-dark-800 hover:border-green-200 dark:hover:border-dark-500'}`
              : `${votePanel === 'up' ? 'border-green-500/50 bg-dark-700 ring-2 ring-green-500/20' : 'border-dark-600 bg-dark-800 hover:border-dark-500'}`
          }`}
        >
          <div className="flex items-center gap-2 mb-2">
            <ThumbsUp className="h-4 w-4 text-green-500" />
            <span className={`text-xs font-semibold uppercase tracking-wide ${isLight ? 'text-zinc-500 dark:text-zinc-400' : 'text-dark-400'}`}>
              Upvotes
            </span>
            <ChevronDown className={`h-3 w-3 ml-auto ${isLight ? 'text-zinc-400 dark:text-zinc-500' : 'text-dark-500'} ${votePanel === 'up' ? 'rotate-180' : ''}`} />
          </div>
          <p className={`text-2xl font-bold tabular-nums ${isLight ? 'text-zinc-900 dark:text-zinc-100' : 'text-white'}`}>{data.upvotes}</p>
          <p className={`text-[11px] mt-1 ${isLight ? 'text-zinc-400 dark:text-zinc-500' : 'text-dark-500'}`}>Tap to see which songs</p>
        </button>

        <button
          type="button"
          onClick={() => setVotePanel((p) => (p === 'down' ? null : 'down'))}
          className={`p-4 rounded-2xl border text-left transition-all ${
            isLight
              ? `shadow-sm ${votePanel === 'down' ? 'border-red-400 dark:border-red-500/50 bg-red-50 dark:bg-dark-700 ring-2 ring-red-200 dark:ring-red-500/20' : 'border-zinc-200 dark:border-dark-600 bg-white dark:bg-dark-800 hover:border-red-200 dark:hover:border-dark-500'}`
              : `${votePanel === 'down' ? 'border-red-500/50 bg-dark-700 ring-2 ring-red-500/20' : 'border-dark-600 bg-dark-800 hover:border-dark-500'}`
          }`}
        >
          <div className="flex items-center gap-2 mb-2">
            <ThumbsDown className="h-4 w-4 text-red-500" />
            <span className={`text-xs font-semibold uppercase tracking-wide ${isLight ? 'text-zinc-500 dark:text-zinc-400' : 'text-dark-400'}`}>
              Downvotes
            </span>
            <ChevronDown className={`h-3 w-3 ml-auto ${isLight ? 'text-zinc-400 dark:text-zinc-500' : 'text-dark-500'} ${votePanel === 'down' ? 'rotate-180' : ''}`} />
          </div>
          <p className={`text-2xl font-bold tabular-nums ${isLight ? 'text-zinc-900 dark:text-zinc-100' : 'text-white'}`}>{data.downvotes}</p>
          <p className={`text-[11px] mt-1 ${isLight ? 'text-zinc-400 dark:text-zinc-500' : 'text-dark-500'}`}>Tap to see which songs</p>
        </button>
      </div>

      {votePanel && (
        <div
          className={`rounded-2xl border p-5 shadow-sm ${
            isLight ? 'bg-white dark:bg-dark-800 border-zinc-200 dark:border-dark-600' : 'bg-dark-800 border-dark-600'
          }`}
        >
          <h4 className={`text-sm font-bold mb-1 ${isLight ? 'text-zinc-900 dark:text-zinc-100' : 'text-white'}`}>
            {votePanel === 'up' ? 'Songs people upvoted' : 'Songs people downvoted'}
          </h4>
          <p className={`text-xs mb-4 ${isLight ? 'text-zinc-500 dark:text-zinc-400' : 'text-dark-400'}`}>
            Count = how many times someone pressed up or down for that track (same person can count more than once if
            they changed their vote).
          </p>
          {(votePanel === 'up' ? votesUpBySong : votesDownBySong).length === 0 ? (
            <p className={`text-sm ${isLight ? 'text-zinc-400 dark:text-zinc-500' : 'text-dark-500'}`}>Nothing in this period.</p>
          ) : (
            <ul
              className={`space-y-2 max-h-60 overflow-y-auto divide-y ${
                isLight ? 'divide-zinc-100 dark:divide-dark-700' : 'divide-dark-700'
              }`}
            >
              {(votePanel === 'up' ? votesUpBySong : votesDownBySong).map((row, i) => (
                <li key={i} className="flex items-center gap-3 py-2 first:pt-0">
                  <span className={`text-xs font-bold w-6 text-right ${isLight ? 'text-zinc-400 dark:text-zinc-500' : 'text-dark-500'}`}>{i + 1}</span>
                  <span className={`flex-1 text-sm ${isLight ? 'text-zinc-800 dark:text-zinc-100' : 'text-zinc-100'}`}>{row.name}</span>
                  <span
                    className={`text-sm font-bold tabular-nums px-2 py-1 rounded-lg ${
                      votePanel === 'up'
                        ? isLight
                          ? 'bg-green-100 dark:bg-green-500/20 text-green-800 dark:text-green-300'
                          : 'bg-green-500/20 text-green-300'
                        : isLight
                          ? 'bg-red-100 dark:bg-red-500/20 text-red-800 dark:text-red-300'
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

      {/* Main charts */}
      <div className="space-y-6">
        <HourlyActivityChart hourlyActivity={data.hourlyActivity} isLight={isLight} />

        <div>
          {!hasVolumeAnalytics ? (
            <div
              className={`rounded-2xl border p-8 text-center ${
                isLight ? 'bg-zinc-50 dark:bg-dark-800 border-zinc-200 dark:border-dark-600' : 'bg-dark-800 border-dark-600'
              }`}
            >
              <Volume2 className={`h-10 w-10 mx-auto mb-3 ${isLight ? 'text-zinc-300 dark:text-dark-600' : 'text-dark-600'}`} />
              <p className={`text-sm font-medium ${isLight ? 'text-zinc-700 dark:text-zinc-200' : 'text-dark-200'}`}>No volume feedback yet</p>
              <p className={`text-xs mt-2 max-w-md mx-auto ${isLight ? 'text-zinc-500 dark:text-zinc-400' : 'text-dark-400'}`}>
                When guests use &quot;too loud&quot; / &quot;too quiet&quot; on the voting page, you&apos;ll see a chart
                here showing which volume levels got the most complaints.
              </p>
            </div>
          ) : (
            <VolumeLevelChart vf={vf} maxVolBin={maxVolBin} isLight={isLight} />
          )}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <RankedBarList
            title="Top requested songs"
            icon={TrendingUp}
            rows={data.topSongs}
            isLight={isLight}
            accent="brand"
          />
          <RankedBarList title="Top artists" icon={Users} rows={data.topArtists} isLight={isLight} accent="purple" />
        </div>
      </div>
    </div>
  );
}
