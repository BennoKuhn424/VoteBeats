import { useEffect, useState } from 'react';
import { extractPalette, fallbackPalette } from '../utils/albumColors';

/**
 * Resolve a colour palette for the current track's artwork, used to tint the
 * now-playing ambient visualiser.
 *
 * Starts from the deterministic fallback (instant, no flash of brand-purple on
 * every song) and upgrades to the real artwork colours once they've been read.
 * Re-extracts whenever the artwork URL changes; ignores a stale resolve if the
 * song changed mid-flight or the component unmounted.
 *
 * @param {string} artworkUrl  album art URL (may be empty)
 * @param {string} seed        stable per-song string (id/title) for the fallback
 * @returns {string[]} palette of hex colours, brightest first (always ≥1)
 */
export default function useAlbumPalette(artworkUrl, seed = '') {
  const [palette, setPalette] = useState(() => fallbackPalette(seed || artworkUrl || ''));

  useEffect(() => {
    let active = true;
    // Reset to the deterministic seed colours immediately so a slow/failed
    // artwork fetch never leaves the previous song's colours on screen.
    setPalette(fallbackPalette(seed || artworkUrl || ''));
    extractPalette(artworkUrl, seed).then((next) => {
      if (active && Array.isArray(next) && next.length) setPalette(next);
    });
    return () => {
      active = false;
    };
  }, [artworkUrl, seed]);

  return palette;
}
