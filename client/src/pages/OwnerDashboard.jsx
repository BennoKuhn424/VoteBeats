import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  LogOut,
  RefreshCw,
  Users,
  Building2,
  Wallet,
  Percent,
  Activity,
  Radio,
} from 'lucide-react';
import api from '../utils/api';
import Logo from '../components/shared/Logo';

export default function OwnerDashboard() {
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const res = await api.getOwnerOverview();
      setData(res.data);
      setError('');
    } catch (e) {
      setError(e.response?.data?.error || 'Could not load dashboard');
      if (e.response?.status === 401 || e.response?.status === 403) {
        localStorage.removeItem('speeldit_token');
        localStorage.removeItem('speeldit_role');
        navigate('/venue/login', { replace: true });
      }
    } finally {
      setLoading(false);
    }
  }, [navigate]);

  useEffect(() => {
    const token = localStorage.getItem('speeldit_token');
    const role = localStorage.getItem('speeldit_role');
    if (!token || role !== 'owner') {
      navigate('/venue/login', { replace: true });
      return;
    }
    load();
    const t = setInterval(load, 20000);
    return () => clearInterval(t);
  }, [navigate, load]);

  function handleLogout() {
    localStorage.removeItem('speeldit_token');
    localStorage.removeItem('speeldit_role');
    localStorage.removeItem('speeldit_venue_code');
    navigate('/venue/login');
  }

  if (loading && !data) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
        <RefreshCw className="w-10 h-10 text-brand-400 animate-spin" />
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="min-h-screen bg-zinc-950 text-white flex flex-col items-center justify-center gap-4 px-4">
        <p className="text-red-400">{error}</p>
        <button type="button" onClick={() => navigate('/venue/login')} className="text-brand-400 underline">
          Back to login
        </button>
      </div>
    );
  }

  const d = data || {};

  return (
    <div className="min-h-screen bg-gradient-to-br from-zinc-950 via-zinc-900 to-zinc-950 text-zinc-100 pb-12">
      <header className="border-b border-zinc-800 bg-zinc-950/80 backdrop-blur sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-4 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Logo size="md" />
            <div>
              <h1 className="text-lg font-bold text-white">Speeldit — Owner</h1>
              <p className="text-xs text-zinc-500">Platform overview & revenue</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => load()}
              className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-zinc-700 text-sm text-zinc-300 hover:bg-zinc-800"
            >
              <RefreshCw className="w-4 h-4" />
              Refresh
            </button>
            <button
              type="button"
              onClick={handleLogout}
              className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-zinc-800 text-sm text-zinc-200 hover:bg-zinc-700"
            >
              <LogOut className="w-4 h-4" />
              Log out
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-8 space-y-8">
        <p className="text-sm text-zinc-500">
          <Radio className="w-4 h-4 inline mr-1 text-brand-400" />
          Live connections: Socket.IO clients (browser tabs / devices connected to the app). Not exact unique people.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard
            icon={<Radio className="w-5 h-5 text-emerald-400" />}
            label="Live connections"
            value={String(d.connectedClients ?? 0)}
            sub="Across all venues"
          />
          <StatCard
            icon={<Building2 className="w-5 h-5 text-brand-400" />}
            label="Registered venues"
            value={String(d.venueCount ?? 0)}
            sub="Total accounts"
          />
          <StatCard
            icon={<Activity className="w-5 h-5 text-amber-400" />}
            label="Analytics (24h)"
            value={String(d.analyticsEvents24h ?? 0)}
            sub="Events across venues"
          />
          <StatCard
            icon={<Users className="w-5 h-5 text-cyan-400" />}
            label="Pay-to-play (month)"
            value={String(d.paymentCountMonth ?? 0)}
            sub={`Payments in ${d.monthLabel || '—'}`}
          />
        </div>

        <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-6">
          <h2 className="text-sm font-semibold text-zinc-400 uppercase tracking-wide mb-4 flex items-center gap-2">
            <Percent className="w-4 h-4" />
            Revenue split (VENUE_EARNINGS_PERCENT = {d.venueSharePercent}% to venues)
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <h3 className="text-zinc-500 text-xs font-medium mb-3">All time</h3>
              <div className="space-y-2 text-sm">
                <Row label="Gross (customers)" value={`R ${d.allTimeGrossRand}`} />
                <Row label="Your cut (platform)" value={`R ${d.allTimePlatformRand}`} highlight />
                <Row label="Venues’ share" value={`R ${d.allTimeVenueRand}`} />
                <Row label="Payments" value={String(d.paymentCountAllTime)} />
              </div>
            </div>
            <div>
              <h3 className="text-zinc-500 text-xs font-medium mb-3">This month ({d.monthLabel})</h3>
              <div className="space-y-2 text-sm">
                <Row label="Gross" value={`R ${d.monthGrossRand}`} />
                <Row label="Your cut (platform)" value={`R ${d.monthPlatformRand}`} highlight />
                <Row label="Venues’ share" value={`R ${d.monthVenueRand}`} />
                <Row label="Payments" value={String(d.paymentCountMonth)} />
              </div>
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50 overflow-hidden">
          <div className="px-6 py-4 border-b border-zinc-800 flex items-center gap-2">
            <Wallet className="w-5 h-5 text-brand-400" />
            <h2 className="font-semibold">This month by venue</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="bg-zinc-950/80 text-zinc-500 text-xs uppercase">
                <tr>
                  <th className="px-6 py-3">Venue</th>
                  <th className="px-6 py-3">Gross</th>
                  <th className="px-6 py-3">Your cut</th>
                  <th className="px-6 py-3">Payments</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800">
                {(d.venueMonthRows || []).length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-6 py-8 text-center text-zinc-500">
                      No payments this month yet.
                    </td>
                  </tr>
                ) : (
                  d.venueMonthRows.map((row) => (
                    <tr key={row.venueCode} className="hover:bg-zinc-800/40">
                      <td className="px-6 py-3 font-medium text-white">{row.venueName}</td>
                      <td className="px-6 py-3">R {row.grossRand}</td>
                      <td className="px-6 py-3 text-emerald-400">R {row.platformShareRand}</td>
                      <td className="px-6 py-3 text-zinc-400">{row.paymentsCount}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50 overflow-hidden">
          <div className="px-6 py-4 border-b border-zinc-800">
            <h2 className="font-semibold">All venues</h2>
          </div>
          <ul className="divide-y divide-zinc-800 max-h-64 overflow-y-auto">
            {(d.venues || []).map((v) => (
              <li key={v.code} className="px-6 py-3 flex justify-between gap-4 text-sm">
                <span className="font-medium text-white">{v.name}</span>
                <span className="text-zinc-500 font-mono">{v.code}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50 overflow-hidden">
          <div className="px-6 py-4 border-b border-zinc-800">
            <h2 className="font-semibold">Recent payments</h2>
          </div>
          <ul className="divide-y divide-zinc-800">
            {(d.recentPayments || []).slice(0, 15).map((p, i) => (
              <li key={`${p.createdAt}-${i}`} className="px-6 py-2 flex items-center justify-between text-sm">
                <span className="text-zinc-400 font-mono">{p.venueCode}</span>
                <span className="text-white">R {p.amountRand}</span>
                <span className="text-zinc-500 text-xs">
                  {new Date(p.createdAt).toLocaleString()}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </main>
    </div>
  );
}

function StatCard({ icon, label, value, sub }) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
      <div className="flex items-center gap-2 text-zinc-500 text-xs font-medium uppercase tracking-wide mb-2">
        {icon}
        {label}
      </div>
      <p className="text-2xl font-bold text-white tabular-nums">{value}</p>
      <p className="text-xs text-zinc-500 mt-1">{sub}</p>
    </div>
  );
}

function Row({ label, value, highlight }) {
  return (
    <div className="flex justify-between gap-4">
      <span className="text-zinc-500">{label}</span>
      <span className={highlight ? 'font-semibold text-emerald-400' : 'text-zinc-200'}>{value}</span>
    </div>
  );
}
