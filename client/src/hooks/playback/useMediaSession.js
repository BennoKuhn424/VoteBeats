import { useEffect } from 'react';
import { PLAYER_STATES } from './constants';

/**
 * Media Session API: lock screen / Control Center show correct track and controls.
 *
 * Pure side-effect hook — no state of its own. Reads queue, playerState,
 * playbackTime, playbackDuration and wires up action handlers for
 * play/pause/next/previous.
 */
export function useMediaSession({ queue, playerState, playbackTime, playbackDuration, playPause, skip, restart }) {
  // Metadata + position state
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;
    const np = queue.nowPlaying;
    const isPlaying = playerState === PLAYER_STATES.PLAYING;
    const isPaused = playerState === PLAYER_STATES.PAUSED;
    navigator.mediaSession.playbackState = isPlaying ? 'playing' : isPaused ? 'paused' : 'none';
    if (np) {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: np.title || 'Speeldit',
        artist: np.artist || '',
        album: '',
        artwork: np.albumArt
          ? [{ src: np.albumArt, sizes: '512x512', type: 'image/jpeg' }]
          : [],
      });
      if (isPlaying && playbackDuration > 0 && 'setPositionState' in navigator.mediaSession) {
        try {
          navigator.mediaSession.setPositionState({
            duration: playbackDuration,
            position: playbackTime,
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
