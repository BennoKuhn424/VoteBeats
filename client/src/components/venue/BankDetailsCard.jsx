import { useState, useEffect } from 'react';
import { Landmark, Check, AlertCircle } from 'lucide-react';
import api from '../../utils/api';

const ACCOUNT_TYPES = [
  { value: 'cheque', label: 'Cheque / Current' },
  { value: 'savings', label: 'Savings' },
  { value: 'transmission', label: 'Transmission' },
];

export default function BankDetailsCard({ venueCode }) {
  const [details, setDetails] = useState({
    bankName: '',
    accountHolder: '',
    accountNumber: '',
    branchCode: '',
    accountType: 'cheque',
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const [hasExisting, setHasExisting] = useState(false);

  useEffect(() => {
    if (!venueCode) return;
    (async () => {
      try {
        const res = await api.getVenueBankDetails(venueCode);
        const bd = res.data.bankDetails;
        if (bd) {
          setDetails({
            bankName: bd.bankName || '',
            accountHolder: bd.accountHolder || '',
            accountNumber: bd.accountNumber || '',
            branchCode: bd.branchCode || '',
            accountType: bd.accountType || 'cheque',
          });
          setHasExisting(true);
        }
      } catch (err) {
        console.error('Bank details load error', err);
      } finally {
        setLoading(false);
      }
    })();
  }, [venueCode]);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setSaved(false);
    setSaving(true);
    try {
      await api.updateVenueBankDetails(venueCode, details);
      setSaved(true);
      setHasExisting(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to save bank details');
    } finally {
      setSaving(false);
    }
  }

  function update(field, value) {
    setDetails((d) => ({ ...d, [field]: value }));
  }

  const inputClass =
    'w-full px-3 py-2.5 border border-zinc-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent';

  return (
    <div className="mb-6 p-6 bg-white rounded-xl border border-zinc-200 shadow-sm">
      <div className="flex items-start gap-3 mb-4">
        <div className="p-2 bg-blue-100 rounded-lg">
          <Landmark className="h-5 w-5 text-blue-600" />
        </div>
        <div className="flex-1">
          <h3 className="text-sm font-medium text-zinc-600 uppercase tracking-wide mb-1">
            Payout bank details
          </h3>
          <p className="text-sm text-zinc-500">
            Where we send your monthly 70% share. Updates take effect on the next payout run.
          </p>
        </div>
      </div>

      {loading ? (
        <div className="h-48 bg-zinc-50 rounded-lg animate-pulse" />
      ) : (
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-zinc-600 mb-1">Bank name</label>
              <input
                type="text"
                value={details.bankName}
                onChange={(e) => update('bankName', e.target.value)}
                placeholder="e.g. FNB, Standard Bank"
                className={inputClass}
                required
                maxLength={100}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-600 mb-1">Account holder</label>
              <input
                type="text"
                value={details.accountHolder}
                onChange={(e) => update('accountHolder', e.target.value)}
                placeholder="Full name on account"
                className={inputClass}
                required
                maxLength={100}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-600 mb-1">Account number</label>
              <input
                type="text"
                inputMode="numeric"
                value={details.accountNumber}
                onChange={(e) => update('accountNumber', e.target.value.replace(/\D/g, ''))}
                placeholder="7-16 digits"
                className={inputClass}
                required
                maxLength={16}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-600 mb-1">Branch code</label>
              <input
                type="text"
                inputMode="numeric"
                value={details.branchCode}
                onChange={(e) => update('branchCode', e.target.value.replace(/\D/g, ''))}
                placeholder="Universal branch code"
                className={inputClass}
                required
                maxLength={6}
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-zinc-600 mb-1">Account type</label>
              <select
                value={details.accountType}
                onChange={(e) => update('accountType', e.target.value)}
                className={inputClass}
              >
                {ACCOUNT_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </div>
          </div>

          {error && (
            <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-lg">
              <AlertCircle className="h-4 w-4 text-red-600 shrink-0 mt-0.5" />
              <p className="text-sm text-red-700">{error}</p>
            </div>
          )}

          <div className="flex items-center gap-3 pt-1">
            <button
              type="submit"
              disabled={saving}
              className="inline-flex items-center gap-2 px-4 py-2.5 bg-brand-500 text-white text-sm font-semibold rounded-lg hover:bg-brand-600 transition-colors disabled:opacity-50 min-h-[44px]"
            >
              {saving ? 'Saving…' : hasExisting ? 'Update bank details' : 'Save bank details'}
            </button>
            {saved && (
              <span className="inline-flex items-center gap-1.5 text-sm text-green-700">
                <Check className="h-4 w-4" /> Saved
              </span>
            )}
          </div>
        </form>
      )}
    </div>
  );
}
