import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import { usePlaybackRefs } from './usePlaybackRefs';
import { PLAYER_STATES } from './constants';

describe('usePlaybackRefs', () => {
  it('returns a stable refs object across re-renders', () => {
    const { result, rerender } = renderHook(() => usePlaybackRefs());
    const first = result.current;
    rerender();
    expect(result.current).toBe(first); // same reference
  });

  it('initialises all expected fields', () => {
    const { result } = renderHook(() => usePlaybackRefs());
    const r = result.current;

    // Playback provider
    expect(r.provider).toBeNull();

    // Player state
    expect(r.playerState).toBe(PLAYER_STATES.NOT_READY);
    expect(r.currentSongId).toBeNull();
    expect(r.hasUserGesture).toBe(false);

    // Play lock
    expect(r.playLock).toBe(false);
    expect(r.pendingQueue).toBeNull();

    // Autoplay
    expect(r.autoplayMode).toBe('playlist');
    expect(r.autofill404Until).toBe(0);
    expect(r.autofillBackoff).toBe(5000);
    expect(r.autofillDismissedAt).toBe(0);

    // Error tracking
    expect(r.playFailCount).toBe(0);
    expect(r.transitionWatchdog).toBeNull();
    expect(r.stuckSince).toBeNull();
    expect(r.divergenceSince).toBeNull();
    expect(r.hcLastFired).toEqual({});

    // Queue
    expect(r.queue).toEqual({ nowPlaying: null, upcoming: [] });

    // Function refs
    expect(r.playSong).toBeNull();
    expect(r.handleQueueUpdate).toBeNull();
    expect(r.fetchQueue).toBeNull();
  });

  it('allows mutation by any hook (shared-ownership contract)', () => {
    const { result } = renderHook(() => usePlaybackRefs());
    result.current.currentSongId = 'song_123';
    result.current.playLock = true;
    expect(result.current.currentSongId).toBe('song_123');
    expect(result.current.playLock).toBe(true);
  });
});
