import { useState, useEffect } from 'react';
import api from '../../utils/api';

/**
 * Volume management: state, localStorage persistence, MusicKit sync, server reporting.
 *
 * Reads from refs: music.
 */
export function useVolumeControl(refs, venueCode) {
  const [volume, setVolume] = useState(() => {
    const raw = localStorage.getItem('speeldit_volume');
    if (raw === null) return 70;
    const parsed = Number(raw);
    return (!isNaN(parsed) && parsed >= 0) ? Math.min(parsed, 100) : 70;
  });

  // Sync to localStorage + MusicKit
  useEffect(() => {
    localStorage.setItem('speeldit_volume', String(volume));
    if (refs.music) refs.music.volume = volume / 100;
  }, [refs, volume]);

  // Debounced report to server (for customer feedback correlation)
  useEffect(() => {
    if (!venueCode) return;
    const t = setTimeout(() => {
      api.reportPlayerVolume(venueCode, volume).catch(() => {});
    }, 800);
    return () => clearTimeout(t);
  }, [venueCode, volume]);

  return { volume, setVolume };
}
