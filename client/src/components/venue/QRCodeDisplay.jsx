import { QRCodeSVG } from 'qrcode.react';
import { buildVotingUrl } from '../../utils/publicUrl';

export default function QRCodeDisplay({ venueCode, venueName, variant = 'dark' }) {
  const votingUrl = buildVotingUrl(venueCode);

  const isLight = variant === 'light';
  const qrBgClass = isLight
    ? 'bg-white border-2 border-zinc-200 rounded-lg p-6 flex justify-center'
    : 'flex justify-center p-5 bg-dark-950 rounded-xl';

  if (isLight) {
    // QR codes must stay on a light background even in dark mode — the
    // scanner contrast ratio depends on dark-on-white. Wrap it in a white
    // panel regardless of theme.
    return (
      <div className="bg-white border-2 border-zinc-200 dark:border-dark-600 rounded-lg p-6 flex items-center justify-center">
        <QRCodeSVG value={votingUrl} size={180} level="M" />
      </div>
    );
  }

  return (
    <div className="bg-dark-800 rounded-2xl border border-dark-600 p-6">
      <h2 className="text-lg font-bold mb-2">Customer voting link</h2>
      <p className="text-dark-400 text-sm mb-4">
        Scan with your phone to vote on music at {venueName}
      </p>
      <div className={qrBgClass}>
        <QRCodeSVG value={votingUrl} size={180} level="M" />
      </div>
      <p className="mt-4 text-xs text-dark-500 break-all font-mono">{votingUrl}</p>
    </div>
  );
}
