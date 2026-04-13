import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useHealthCheck } from './useHealthCheck';
import { PLAYER_STATES, ERRORS } from './constants';

function createRefs(overrides = {}) {
  return {
    music: null,
    playerState: PLAYER_STATES.IDLE,
    currentSongId: null,
    playLock: false,
    queue: { nowPlaying: null, upcoming: [] },
    stuckSince: null,
    divergenceSince: null,
    hcLastFired: {},
    ...overrides,
  };
}

function createMusicMock(overrides = {}) {
  return {
    playbackState: 0,
    nowPlayingItem: null,
    ...overrides,
  };
}

describe('useHealthCheck', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('does nothing when venueCode is falsy', () => {
    const refs = createRefs();
    const fetchQueue = vi.fn();
    const setErrorWithPriority = vi.fn();
    renderHook(() => useHealthCheck(refs, '', { fetchQueue, setErrorWithPriority }));

    vi.advanceTimersByTime(25000);
    expect(fetchQueue).not.toHaveBeenCalled();
    expect(setErrorWithPriority).not.toHaveBeenCalled();
  });

  it('does nothing when music is null', () => {
    const refs = createRefs({ music: null });
    const setErrorWithPriority = vi.fn();
    renderHook(() => useHealthCheck(refs, 'V1', { fetchQueue: vi.fn(), setErrorWithPriority }));

    vi.advanceTimersByTime(25000);
    expect(setErrorWithPriority).not.toHaveBeenCalled();
  });

  it('skips check when player is transitioning', () => {
    const refs = createRefs({
      music: createMusicMock({ playbackState: 0 }),
      playerState: PLAYER_STATES.TRANSITIONING,
      queue: { nowPlaying: { appleId: 'a1' }, upcoming: [] },
    });
    const setErrorWithPriority = vi.fn();
    renderHook(() => useHealthCheck(refs, 'V1', { fetchQueue: vi.fn(), setErrorWithPriority }));

    vi.advanceTimersByTime(25000);
    expect(setErrorWithPriority).not.toHaveBeenCalled();
  });

  it('skips check when playLock is held', () => {
    const refs = createRefs({
      music: createMusicMock({ playbackState: 0 }),
      playLock: true,
      queue: { nowPlaying: { appleId: 'a1' }, upcoming: [] },
    });
    const setErrorWithPriority = vi.fn();
    renderHook(() => useHealthCheck(refs, 'V1', { fetchQueue: vi.fn(), setErrorWithPriority }));

    vi.advanceTimersByTime(25000);
    expect(setErrorWithPriority).not.toHaveBeenCalled();
  });

  it('detects stuck player (idle >15s with server nowPlaying)', () => {
    const refs = createRefs({
      music: createMusicMock({ playbackState: 0 }),
      queue: { nowPlaying: { appleId: 'a1' }, upcoming: [] },
    });
    const fetchQueue = vi.fn();
    const setErrorWithPriority = vi.fn();
    renderHook(() => useHealthCheck(refs, 'V1', { fetchQueue, setErrorWithPriority }));

    // First tick at 12s: sets stuckSince
    vi.advanceTimersByTime(12000);
    expect(refs.stuckSince).not.toBeNull();
    expect(setErrorWithPriority).not.toHaveBeenCalled();

    // Manually set stuckSince to >15s ago so the next tick fires the error
    // (fake timers advance Date.now via vi.advanceTimersByTime, but the
    //  health check uses Date.now() which does track fake timer advances)
    refs.stuckSince = Date.now() - 16000;

    // Second tick: sees >15s since stuckSince — fires error
    vi.advanceTimersByTime(12000);
    expect(fetchQueue).toHaveBeenCalled();
    expect(setErrorWithPriority).toHaveBeenCalledWith(ERRORS.DISCONNECTED);
    expect(refs.currentSongId).toBeNull();
    expect(refs.stuckSince).toBeNull();
  });

  it('detects track divergence (confirmed on second tick)', () => {
    const refs = createRefs({
      music: createMusicMock({
        playbackState: 2,
        nowPlayingItem: { id: 'client_track' },
      }),
      queue: { nowPlaying: { appleId: 'server_track' }, upcoming: [] },
    });
    const setErrorWithPriority = vi.fn();
    renderHook(() => useHealthCheck(refs, 'V1', { fetchQueue: vi.fn(), setErrorWithPriority }));

    // First tick: first detection
    vi.advanceTimersByTime(12000);
    expect(refs.divergenceSince).not.toBeNull();
    expect(setErrorWithPriority).not.toHaveBeenCalled();

    // Second tick: confirmed
    vi.advanceTimersByTime(12000);
    expect(setErrorWithPriority).toHaveBeenCalledWith(ERRORS.DISCONNECTED);
    expect(refs.currentSongId).toBeNull();
    expect(refs.divergenceSince).toBeNull();
  });

  it('clears divergence when tracks match', () => {
    const refs = createRefs({
      music: createMusicMock({
        playbackState: 2,
        nowPlayingItem: { id: 'same_track' },
      }),
      queue: { nowPlaying: { appleId: 'same_track' }, upcoming: [] },
      divergenceSince: Date.now(), // was diverging
    });
    const setErrorWithPriority = vi.fn();
    renderHook(() => useHealthCheck(refs, 'V1', { fetchQueue: vi.fn(), setErrorWithPriority }));

    vi.advanceTimersByTime(12000);
    expect(refs.divergenceSince).toBeNull();
    expect(setErrorWithPriority).not.toHaveBeenCalled();
  });

  it('respects 60s cooldown — same error not re-fired within window', () => {
    const refs = createRefs({
      music: createMusicMock({
        playbackState: 2,
        nowPlayingItem: { id: 'client_track' },
      }),
      queue: { nowPlaying: { appleId: 'server_track' }, upcoming: [] },
    });
    const setErrorWithPriority = vi.fn();
    renderHook(() => useHealthCheck(refs, 'V1', { fetchQueue: vi.fn(), setErrorWithPriority }));

    // First + second tick: divergence confirmed, error fired
    vi.advanceTimersByTime(24000);
    expect(setErrorWithPriority).toHaveBeenCalledTimes(1);

    // Reset divergenceSince so it can detect again
    refs.divergenceSince = null;

    // Third + fourth tick: divergence again, but cooldown blocks the banner
    vi.advanceTimersByTime(24000); // total 48s, still within 60s cooldown
    expect(setErrorWithPriority).toHaveBeenCalledTimes(1); // NOT called again
  });

  it('resets stuckSince when player starts playing', () => {
    const refs = createRefs({
      music: createMusicMock({ playbackState: 0 }),
      queue: { nowPlaying: { appleId: 'a1' }, upcoming: [] },
    });
    renderHook(() => useHealthCheck(refs, 'V1', { fetchQueue: vi.fn(), setErrorWithPriority: vi.fn() }));

    // First tick: idle, sets stuckSince
    vi.advanceTimersByTime(12000);
    expect(refs.stuckSince).not.toBeNull();

    // Player starts playing before second tick
    refs.music.playbackState = 2;
    refs.music.nowPlayingItem = { id: 'a1' };

    vi.advanceTimersByTime(12000);
    expect(refs.stuckSince).toBeNull(); // cleared
  });

  it('cleans up interval on unmount', () => {
    const refs = createRefs({ music: createMusicMock() });
    const { unmount } = renderHook(() =>
      useHealthCheck(refs, 'V1', { fetchQueue: vi.fn(), setErrorWithPriority: vi.fn() }));
    unmount();
    // Advancing timers after unmount should not cause errors
    vi.advanceTimersByTime(50000);
  });
});
