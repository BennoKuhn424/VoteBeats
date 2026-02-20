import { QRCodeSVG } from 'qrcode.react';

export default function QRCodeDisplay({ venueCode, venueName }) {
  // Use VITE_PUBLIC_URL for testing on phone (e.g. http://10.0.0.113:5173) so QR works when scanned
  const baseUrl =
    import.meta.env.VITE_PUBLIC_URL ||
    (typeof window !== 'undefined' ? window.location.origin : 'https://yourapp.vercel.app');
  const votingUrl = `${baseUrl.replace(/\/$/, '')}/v/${venueCode}`;

  return (
    <div className="bg-dark-800 rounded-2xl border border-dark-600 p-6">
      <h2 className="text-lg font-bold mb-2">Customer voting link</h2>
      <p className="text-dark-400 text-sm mb-4">
        Scan with your phone to vote on music at {venueName}
      </p>
      <div className="flex justify-center p-5 bg-dark-950 rounded-xl">
        <QRCodeSVG value={votingUrl} size={180} level="M" />
      </div>
      <p className="mt-4 text-xs text-dark-500 break-all font-mono">{votingUrl}</p>
    </div>
  );
}
