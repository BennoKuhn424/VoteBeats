import { useRef } from 'react';
import { PLAYER_STATES } from './constants';

/**
 * Shared mutable refs bag — the "engine" that all playback hooks read/write.
 *
 * React state triggers renders; refs are synchronous and safe to read in
 * async callbacks, MusicKit event listeners, and setTimeout guards without
 * stale-closure bugs. Every playback hook receives this bag so they can
 * coordinate without circular dependencies.
 *
 * Rules:
 *   1. Only the hook that "owns" a ref should write to it.
 *   2. Any hook may read any ref.
 *   3. Function refs (playSong, handleQueueUpdate, fetchQueue) are set by
 *      the hook that defines the function and called by hooks that need it.
 */
export function usePlaybackRefs() {
  const refs = useRef(null);
  if (refs.current === null) {
    refs.current = {
      // ── Active PlaybackProvider (owns the SDK; hooks never touch the SDK directly). ──
      provider: null,

      // ── Player state (synchronous mirror of React state) ──
      playerState: PLAYER_STATES.NOT_READY,
      currentSongId: null,
      hasUserGesture: false,
      lastGestureAt: 0,
      lastPlayStartedAt: 0,

      // ── Play lock: serialises playSong calls ──
      playLock: false,
      pendingQueue: null,

      // ── Autoplay ──
      autoplayMode: 'playlist',
      autofill404Until: 0,
      autofillBackoff: 5000,
      autofillDismissedAt: 0,

      // ── Error/health tracking ──
      playFailCount: 0,
      transitionWatchdog: null,
      stuckSince: null,
      divergenceSince: null,
      hcLastFired: {},

      // ── Queue (synchronous mirror) ──
      queue: { nowPlaying: null, upcoming: [] },

      // ── Function refs (set by owning hooks) ──
      playSong: null,
      handleQueueUpdate: null,
      fetchQueue: null,
    };
  }
  return refs.current;
}
