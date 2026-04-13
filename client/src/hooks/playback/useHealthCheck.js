import { useEffect } from 'react';
import { PLAYER_STATES, ERRORS } from './constants';

/**
 * Periodic health monitor: detects stuck player and track divergence.
 *
 * Runs every 12s. Checks:
 *   1. Player idle >15s while server has a nowPlaying → force re-fetch
 *   2. MusicKit playing a different track than server → "disconnected" error
 *
 * Uses a 60s cooldown per error message to avoid re-bannering while the
 * condition persists.
 */
export function useHealthCheck(refs, venueCode, { fetchQueue, setErrorWithPriority }) {
  useEffect(() => {
    if (!venueCode) return;

    const HC_BANNER_COOLDOWN_MS = 60_000;
    function hcSetError(msg) {
      const now = Date.now();
      if (now - (refs.hcLastFired[msg] ?? 0) < HC_BANNER_COOLDOWN_MS) return;
      refs.hcLastFired[msg] = now;
      setErrorWithPriority(msg);
    }

    const interval = setInterval(() => {
      const music = refs.music;
      if (!music) return;
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        refs.stuckSince = null;
        refs.divergenceSince = null;
        return;
      }
      const serverNowPlaying = refs.queue?.nowPlaying;
      const mk = music.playbackState;

      if (
        refs.playerState === PLAYER_STATES.TRANSITIONING ||
        refs.playLock ||
        mk === 1
      ) {
        refs.stuckSince = null;
        refs.divergenceSince = null;
        return;
      }

      if (mk === 2) {
        refs.stuckSince = null;
        const serverAppleId = String(serverNowPlaying?.appleId || '');
        const clientAppleId = String(music.nowPlayingItem?.id || '');
        if (serverAppleId && clientAppleId && serverAppleId !== clientAppleId) {
          if (!refs.divergenceSince) {
            refs.divergenceSince = Date.now();
            console.warn('[HC_TRACK_DIVERGENCE] first detection', { serverAppleId, clientAppleId });
          } else {
            console.warn('[HC_TRACK_DIVERGENCE] confirmed', { serverAppleId, clientAppleId });
            hcSetError(ERRORS.DISCONNECTED);
            refs.currentSongId = null;
            refs.divergenceSince = null;
          }
        } else {
          refs.divergenceSince = null;
        }
      } else if (serverNowPlaying && (mk === 0 || mk === 4 || mk === 5)) {
        if (!refs.stuckSince) {
          refs.stuckSince = Date.now();
        } else if (Date.now() - refs.stuckSince > 15000) {
          console.warn('[HC_IDLE_STUCK] player idle >15s while server has nowPlaying');
          fetchQueue();
          hcSetError(ERRORS.DISCONNECTED);
          refs.currentSongId = null;
          refs.stuckSince = null;
        }
      } else {
        refs.stuckSince = null;
      }
    }, 12000);
    return () => clearInterval(interval);
  }, [refs, venueCode, fetchQueue, setErrorWithPriority]);
}
