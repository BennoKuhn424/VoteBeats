import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { usePlaybackEngine } from './usePlaybackEngine';
import { PLAYER_STATES, ERRORS } from './constants';

// Mock api module
vi.mock('../../utils/api', () => ({
  default: {
    reportPlaying: vi.fn(() => Promise.resolve()),
  },
}));

// Mock venuePlaybackPlay — we test that separately
vi.mock('../../utils/venuePlaybackPlay', () => ({
  withTimeout: vi.fn((p) => p),
  buildPreloadAppleIds: vi.fn((song) => [song.appleId]),
  runSetQueueThenPlay: vi.fn(() => Promise.resolve()),
  TRANSITION_WATCHDOG_MS: 50000,
  PLAY_LOCK_SAFETY_MS: 55000,
  STOP_TIMEOUT_MS: 5000,
  POST_STOP_DELAY_MS: 0, // instant in tests
}));

function createRefs(overrides = {}) {
  return {
    music: null,
    playerState: PLAYER_STATES.NOT_READY,
    currentSongId: null,
    hasUserGesture: false,
    playLock: false,
    pendingQueue: null,
    autoplayMode: 'playlist',
    playFailCount: 0,
    transitionWatchdog: null,
    queue: { nowPlaying: null, upcoming: [] },
    hcLastFired: {},
    handleQueueUpdate: null,
    playSong: null,
    ...overrides,
  };
}

function createMusicMock(overrides = {}) {
  return {
    playbackState: 0,
    isAuthorized: true,
    authorize: vi.fn(() => Promise.resolve()),
    stop: vi.fn(() => Promise.resolve()),
    setQueue: vi.fn(() => Promise.resolve()),
    play: vi.fn(() => Promise.resolve()),
    nowPlayingItem: null,
    ...overrides,
  };
}

describe('usePlaybackEngine', () => {
  describe('updatePlayerState', () => {
    it('syncs React state and refs.playerState', () => {
      const refs = createRefs();
      const { result } = renderHook(() => usePlaybackEngine(refs, 'TEST'));

      act(() => { result.current.updatePlayerState(PLAYER_STATES.PLAYING); });
      expect(result.current.playerState).toBe(PLAYER_STATES.PLAYING);
      expect(refs.playerState).toBe(PLAYER_STATES.PLAYING);
    });
  });

  describe('setErrorWithPriority', () => {
    it('sets error when no previous error', () => {
      const refs = createRefs();
      const { result } = renderHook(() => usePlaybackEngine(refs, 'TEST'));

      act(() => { result.current.setErrorWithPriority(ERRORS.PLAYBACK_FAILED); });
      expect(result.current.playerError).toBe(ERRORS.PLAYBACK_FAILED);
    });

    it('higher-priority error overwrites lower-priority', () => {
      const refs = createRefs();
      const { result } = renderHook(() => usePlaybackEngine(refs, 'TEST'));

      act(() => { result.current.setErrorWithPriority(ERRORS.PLAYBACK_FAILED); });
      act(() => { result.current.setErrorWithPriority(ERRORS.NO_INTERNET); });
      expect(result.current.playerError).toBe(ERRORS.NO_INTERNET);
    });

    it('lower-priority error does NOT overwrite higher-priority', () => {
      const refs = createRefs();
      const { result } = renderHook(() => usePlaybackEngine(refs, 'TEST'));

      act(() => { result.current.setErrorWithPriority(ERRORS.NO_INTERNET); });
      act(() => { result.current.setErrorWithPriority(ERRORS.PLAYBACK_FAILED); });
      expect(result.current.playerError).toBe(ERRORS.NO_INTERNET);
    });

    it('null clears any error', () => {
      const refs = createRefs();
      const { result } = renderHook(() => usePlaybackEngine(refs, 'TEST'));

      act(() => { result.current.setErrorWithPriority(ERRORS.NO_INTERNET); });
      act(() => { result.current.setErrorWithPriority(null); });
      expect(result.current.playerError).toBeNull();
    });
  });

  describe('clearError', () => {
    it('clears error and resets health-check cooldown', () => {
      const refs = createRefs({ hcLastFired: { 'some error': Date.now() } });
      const { result } = renderHook(() => usePlaybackEngine(refs, 'TEST'));

      act(() => { result.current.setErrorWithPriority(ERRORS.DISCONNECTED); });
      act(() => { result.current.clearError(); });
      expect(result.current.playerError).toBeNull();
      expect(refs.hcLastFired).toEqual({});
    });
  });

  describe('beginTransition / endTransition', () => {
    it('beginTransition sets state to TRANSITIONING', () => {
      const refs = createRefs();
      const { result } = renderHook(() => usePlaybackEngine(refs, 'TEST'));

      act(() => { result.current.beginTransition(); });
      expect(result.current.playerState).toBe(PLAYER_STATES.TRANSITIONING);
      expect(refs.playerState).toBe(PLAYER_STATES.TRANSITIONING);
    });

    it('endTransition resolves to IDLE when MusicKit is stopped', () => {
      const refs = createRefs({ music: createMusicMock({ playbackState: 0 }) });
      const { result } = renderHook(() => usePlaybackEngine(refs, 'TEST'));

      act(() => { result.current.beginTransition(); });
      act(() => { result.current.endTransition(); });
      expect(result.current.playerState).toBe(PLAYER_STATES.IDLE);
    });

    it('endTransition resolves to PLAYING when MusicKit is playing', () => {
      const refs = createRefs({ music: createMusicMock({ playbackState: 2 }) });
      const { result } = renderHook(() => usePlaybackEngine(refs, 'TEST'));

      act(() => { result.current.beginTransition(); });
      act(() => { result.current.endTransition(); });
      expect(result.current.playerState).toBe(PLAYER_STATES.PLAYING);
    });
  });

  describe('playSong', () => {
    it('sets playLock during execution and releases after', async () => {
      const music = createMusicMock();
      const refs = createRefs({ music });
      const { result } = renderHook(() => usePlaybackEngine(refs, 'TEST'));

      expect(refs.playLock).toBe(false);
      await act(async () => {
        await result.current.playSong({ appleId: 'a1', id: 's1' });
      });
      expect(refs.playLock).toBe(false);
    });

    it('rejects concurrent calls (lock)', async () => {
      const music = createMusicMock();
      const refs = createRefs({ music });
      const { result } = renderHook(() => usePlaybackEngine(refs, 'TEST'));

      // Manually lock
      refs.playLock = true;
      await act(async () => {
        await result.current.playSong({ appleId: 'a1', id: 's1' });
      });
      // play() should NOT have been called — lock prevented it
      expect(music.play).not.toHaveBeenCalled();
    });

    it('replays pending queue update after lock release', async () => {
      const music = createMusicMock();
      const handleQueueUpdate = vi.fn();
      const refs = createRefs({ music, handleQueueUpdate });
      const pendingQ = { nowPlaying: { id: 'p1', appleId: 'pa1' }, upcoming: [] };
      refs.pendingQueue = pendingQ;

      const { result } = renderHook(() => usePlaybackEngine(refs, 'TEST'));

      await act(async () => {
        await result.current.playSong({ appleId: 'a1', id: 's1' });
        // Let microtask flush
        await new Promise((r) => setTimeout(r, 0));
      });
      expect(handleQueueUpdate).toHaveBeenCalledWith(pendingQ);
      expect(refs.pendingQueue).toBeNull();
    });

    it('skips when navigator.onLine is false', async () => {
      const music = createMusicMock();
      const refs = createRefs({ music });
      const { result } = renderHook(() => usePlaybackEngine(refs, 'TEST'));

      const orig = navigator.onLine;
      Object.defineProperty(navigator, 'onLine', { value: false, writable: true, configurable: true });
      await act(async () => {
        await result.current.playSong({ appleId: 'a1', id: 's1' });
      });
      Object.defineProperty(navigator, 'onLine', { value: orig, writable: true, configurable: true });
      expect(music.play).not.toHaveBeenCalled();
    });

    it('registers itself in refs.playSong', () => {
      const refs = createRefs();
      renderHook(() => usePlaybackEngine(refs, 'TEST'));
      expect(typeof refs.playSong).toBe('function');
    });

    it('authorizes before playing when not authorized (mobile first-tap)', async () => {
      const music = createMusicMock({ isAuthorized: false });
      const refs = createRefs({ music });
      const { result } = renderHook(() => usePlaybackEngine(refs, 'TEST'));

      await act(async () => {
        await result.current.playSong({ appleId: 'a1', id: 's1' });
      });
      expect(music.authorize).toHaveBeenCalled();
    });

    it('skips POST_STOP_DELAY when MusicKit is idle (playbackState 0)', async () => {
      const { runSetQueueThenPlay } = await import('../../utils/venuePlaybackPlay');
      const music = createMusicMock({ playbackState: 0 });
      const refs = createRefs({ music });
      const { result } = renderHook(() => usePlaybackEngine(refs, 'TEST'));

      await act(async () => {
        await result.current.playSong({ appleId: 'a1', id: 's1' });
      });
      // stop() should NOT be called when idle
      expect(music.stop).not.toHaveBeenCalled();
      // but setQueue+play should still run
      expect(runSetQueueThenPlay).toHaveBeenCalled();
    });

    it('calls stop + delay only when MusicKit is playing (playbackState 2)', async () => {
      const music = createMusicMock({ playbackState: 2 });
      const refs = createRefs({ music });
      const { result } = renderHook(() => usePlaybackEngine(refs, 'TEST'));

      await act(async () => {
        await result.current.playSong({ appleId: 'a1', id: 's1' });
      });
      expect(music.stop).toHaveBeenCalled();
    });

    it('calls stop + delay only when MusicKit is paused (playbackState 3)', async () => {
      const music = createMusicMock({ playbackState: 3 });
      const refs = createRefs({ music });
      const { result } = renderHook(() => usePlaybackEngine(refs, 'TEST'));

      await act(async () => {
        await result.current.playSong({ appleId: 'a1', id: 's1' });
      });
      expect(music.stop).toHaveBeenCalled();
    });
  });

  describe('playSong — mobile error handling', () => {
    it('AbortError transitions to WAITING (iOS Safari gesture chain broken)', async () => {
      const { runSetQueueThenPlay } = await import('../../utils/venuePlaybackPlay');
      runSetQueueThenPlay.mockRejectedValueOnce(
        new DOMException('The operation was aborted.', 'AbortError')
      );
      const music = createMusicMock();
      const refs = createRefs({ music });
      const { result } = renderHook(() => usePlaybackEngine(refs, 'TEST'));

      await act(async () => {
        await result.current.playSong({ appleId: 'a1', id: 's1' });
      });
      expect(result.current.playerState).toBe(PLAYER_STATES.WAITING);
      expect(result.current.playerError).toBeNull();
    });

    it('NotAllowedError transitions to WAITING (autoplay policy)', async () => {
      const { runSetQueueThenPlay } = await import('../../utils/venuePlaybackPlay');
      runSetQueueThenPlay.mockRejectedValueOnce(
        new DOMException('The request is not allowed', 'NotAllowedError')
      );
      const music = createMusicMock();
      const refs = createRefs({ music });
      const { result } = renderHook(() => usePlaybackEngine(refs, 'TEST'));

      await act(async () => {
        await result.current.playSong({ appleId: 'a1', id: 's1' });
      });
      expect(result.current.playerState).toBe(PLAYER_STATES.WAITING);
      expect(result.current.playerError).toBeNull();
    });

    it('"user gesture interact" message transitions to WAITING', async () => {
      const { runSetQueueThenPlay } = await import('../../utils/venuePlaybackPlay');
      runSetQueueThenPlay.mockRejectedValueOnce(new Error('User must interact with the page first'));
      const music = createMusicMock();
      const refs = createRefs({ music });
      const { result } = renderHook(() => usePlaybackEngine(refs, 'TEST'));

      await act(async () => {
        await result.current.playSong({ appleId: 'a1', id: 's1' });
      });
      expect(result.current.playerState).toBe(PLAYER_STATES.WAITING);
    });

    it('"abort" in message transitions to WAITING (iOS variant wording)', async () => {
      const { runSetQueueThenPlay } = await import('../../utils/venuePlaybackPlay');
      runSetQueueThenPlay.mockRejectedValueOnce(new Error('The play() request was aborted by a new load request'));
      const music = createMusicMock();
      const refs = createRefs({ music });
      const { result } = renderHook(() => usePlaybackEngine(refs, 'TEST'));

      await act(async () => {
        await result.current.playSong({ appleId: 'a1', id: 's1' });
      });
      expect(result.current.playerState).toBe(PLAYER_STATES.WAITING);
    });

    it('timeout error shows SLOW_INTERNET (mobile cellular)', async () => {
      const { runSetQueueThenPlay } = await import('../../utils/venuePlaybackPlay');
      runSetQueueThenPlay.mockRejectedValueOnce(new Error('Timeout after 28000ms'));
      const music = createMusicMock();
      const refs = createRefs({ music });
      const { result } = renderHook(() => usePlaybackEngine(refs, 'TEST'));

      await act(async () => {
        await result.current.playSong({ appleId: 'a1', id: 's1' });
      });
      expect(result.current.playerError).toBe(ERRORS.SLOW_INTERNET);
    });

    it('generic MusicKit error shows PLAYBACK_FAILED and clears currentSongId', async () => {
      const { runSetQueueThenPlay } = await import('../../utils/venuePlaybackPlay');
      runSetQueueThenPlay.mockRejectedValueOnce(new Error('MEDIA_ELEMENT_ERROR: Format error'));
      const music = createMusicMock();
      const refs = createRefs({ music });
      const { result } = renderHook(() => usePlaybackEngine(refs, 'TEST'));

      await act(async () => {
        await result.current.playSong({ appleId: 'a1', id: 's1' });
      });
      expect(refs.currentSongId).toBeNull();
      expect(result.current.playerError).toBe(ERRORS.PLAYBACK_FAILED);
    });

    it('3 consecutive generic failures escalate to NEEDS_ATTENTION', async () => {
      const { runSetQueueThenPlay } = await import('../../utils/venuePlaybackPlay');
      const music = createMusicMock();
      const refs = createRefs({ music });
      const { result } = renderHook(() => usePlaybackEngine(refs, 'TEST'));

      for (let i = 0; i < 3; i++) {
        runSetQueueThenPlay.mockRejectedValueOnce(new Error('MEDIA_ELEMENT_ERROR'));
        await act(async () => {
          await result.current.playSong({ appleId: 'a1', id: 's1' });
        });
      }
      expect(result.current.playerError).toBe(ERRORS.NEEDS_ATTENTION);
    });

    it('AbortError does NOT increment playFailCount', async () => {
      const { runSetQueueThenPlay } = await import('../../utils/venuePlaybackPlay');
      runSetQueueThenPlay.mockRejectedValueOnce(
        new DOMException('The operation was aborted.', 'AbortError')
      );
      const music = createMusicMock();
      const refs = createRefs({ music });
      const { result } = renderHook(() => usePlaybackEngine(refs, 'TEST'));

      await act(async () => {
        await result.current.playSong({ appleId: 'a1', id: 's1' });
      });
      expect(refs.playFailCount).toBe(0);
    });

    it('releases lock after AbortError so retry tap works', async () => {
      const { runSetQueueThenPlay } = await import('../../utils/venuePlaybackPlay');
      runSetQueueThenPlay.mockRejectedValueOnce(
        new DOMException('The operation was aborted.', 'AbortError')
      );
      const music = createMusicMock();
      const refs = createRefs({ music });
      const { result } = renderHook(() => usePlaybackEngine(refs, 'TEST'));

      await act(async () => {
        await result.current.playSong({ appleId: 'a1', id: 's1' });
      });
      expect(refs.playLock).toBe(false);
      expect(result.current.playbackLoading).toBe(false);
    });

    it('releases lock after NotAllowedError so retry tap works', async () => {
      const { runSetQueueThenPlay } = await import('../../utils/venuePlaybackPlay');
      runSetQueueThenPlay.mockRejectedValueOnce(
        new DOMException('The request is not allowed', 'NotAllowedError')
      );
      const music = createMusicMock();
      const refs = createRefs({ music });
      const { result } = renderHook(() => usePlaybackEngine(refs, 'TEST'));

      await act(async () => {
        await result.current.playSong({ appleId: 'a1', id: 's1' });
      });
      expect(refs.playLock).toBe(false);
      expect(result.current.playbackLoading).toBe(false);
    });

    it('endTransition called on generic error during transition', async () => {
      const { runSetQueueThenPlay } = await import('../../utils/venuePlaybackPlay');
      runSetQueueThenPlay.mockRejectedValueOnce(new Error('codec not supported'));
      const music = createMusicMock({ playbackState: 0 });
      const refs = createRefs({ music, playerState: PLAYER_STATES.TRANSITIONING });
      refs.playerState = PLAYER_STATES.TRANSITIONING;
      const { result } = renderHook(() => usePlaybackEngine(refs, 'TEST'));

      await act(async () => {
        await result.current.playSong({ appleId: 'a1', id: 's1' });
      });
      // Should have resolved to IDLE (endTransition with mk=0)
      expect(refs.playerState).not.toBe(PLAYER_STATES.TRANSITIONING);
    });
  });
});
