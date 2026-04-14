import { useEffect, useRef } from 'react';
import { PLAYER_STATES } from './constants';

/**
 * Sanitize an artwork URL for iOS Safari Media Session.
 * iOS fails with "TypeError: Load failed" on:
 *   - http:// URLs (mixed content)
 *   - data: URIs (too large for the media session image loader)
 *   - blob: URIs (can't be fetched cross-context)
 *   - Apple Music URLs with {w}x{h} template tokens not yet replaced
 * Returns null if the URL is unsafe for Media Session.
 */
function sanitizeArtworkUrl(url) {
  if (!url || typeof url !== 'string') return null;
  // Must be HTTPS — iOS blocks mixed-content fetches silently
  if (!url.startsWith('https://')) return null;
  // Apple Music URLs with un-replaced template tokens break the fetch
  if (url.includes('{w}') || url.includes('{h}')) {
    return url.replace(/\{w\}/g, '300').replace(/\{h\}/g, '300');
  }
  return url;
}

/**
 * Media Session API: lock screen / Control Center show correct track and controls.
 *
 * Pure side-effect hook — no state of its own. Reads queue, playerState,
 * playbackTime, playbackDuration and wires up action handlers for
 * play/pause/next/previous.
 */
export function useMediaSession({ queue, playerState, playbackTime, playbackDuration, playPause, skip, restart }) {
  // Track the last artwork URL that was successfully set to avoid re-setting
  // broken URLs on every render.
  const lastArtworkRef = useRef(null);

  // Metadata + position state
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;
    const np = queue.nowPlaying;
    const isPlaying = playerState === PLAYER_STATES.PLAYING;
    const isPaused = playerState === PLAYER_STATES.PAUSED;
    navigator.mediaSession.playbackState = isPlaying ? 'playing' : isPaused ? 'paused' : 'none';
    if (np) {
      const safeUrl = sanitizeArtworkUrl(np.albumArt);
      const artwork = safeUrl ? [{ src: safeUrl, sizes: '300x300' }] : [];
      try {
        navigator.mediaSession.metadata = new MediaMetadata({
          title: np.title || 'Speeldit',
          artist: np.artist || '',
          album: '',
          artwork,
        });
        lastArtworkRef.current = safeUrl;
      } catch (_) {
        // Artwork load failed (CORS redirect, iOS blocked domain, etc.)
        // Fall back to metadata without artwork
        try {
          navigator.mediaSession.metadata = new MediaMetadata({
            title: np.title || 'Speeldit',
            artist: np.artist || '',
            album: '',
          });
          lastArtworkRef.current = null;
        } catch (_) {}
      }
      if (isPlaying && playbackDuration > 0 && 'setPositionState' in navigator.mediaSession) {
        try {
          navigator.mediaSession.setPositionState({
            duration: playbackDuration,
            position: Math.min(playbackTime, playbackDuration),
            playbackRate: 1,
          });
        } catch (_) {}
      } else if ('setPositionState' in navigator.mediaSession) {
        try { navigator.mediaSession.setPositionState(null); } catch (_) {}
      }
    }
  }, [queue.nowPlaying, playerState, playbackTime, playbackDuration]);

  // Action handlers
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;
    const handlers = [
      ['play', () => { playPause(); }],
      ['pause', () => { playPause(); }],
      ['previoustrack', () => { restart(); }],
      ['nexttrack', () => { skip(); }],
    ];
    for (const [action, handler] of handlers) {
      try { navigator.mediaSession.setActionHandler(action, handler); } catch (_) {}
    }
    return () => {
      for (const [action] of handlers) {
        try { navigator.mediaSession.setActionHandler(action, null); } catch (_) {}
      }
    };
  }, [playPause, skip, restart]);
}
