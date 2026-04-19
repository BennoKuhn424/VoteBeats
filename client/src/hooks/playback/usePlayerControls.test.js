import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { usePlayerControls } from './usePlayerControls';
import { PLAYER_STATES, ERRORS } from './constants';

vi.mock('../../utils/api', () => ({
  default: {
    pausePlaying: vi.fn(() => Promise.resolve()),
    reportPlaying: vi.fn(() => Promise.resolve()),
    skipSong: vi.fn(() => Promise.resolve()),
    updateSettings: vi.fn(() => Promise.resolve()),
  },
}));

function createRefs(overrides = {}) {
  return {
    provider: null,
    playerState: PLAYER_STATES.IDLE,
    currentSongId: null,
    hasUserGesture: false,
    playLock: false,
    autoplayMode: 'playlist',
    queue: { nowPlaying: null, upcoming: [] },
    ...overrides,
  };
}

function createMusicMock(overrides = {}) {
  return {
    playbackState: 0,
    isAuthorized: true,
    currentPlaybackTime: 0,
    authorize: vi.fn(() => Promise.resolve()),
    pause: vi.fn(() => Promise.resolve()),
    play: vi.fn(() => Promise.resolve()),
    stop: vi.fn(() => Promise.resolve()),
    seekToTime: vi.fn(() => Promise.resolve()),
    ...overrides,
  };
}

function createDeps(overrides = {}) {
  return {
    playSong: vi.fn(() => Promise.resolve()),
    beginTransition: vi.fn(),
    endTransition: vi.fn(),
    updatePlayerState: vi.fn(),
    setErrorWithPriority: vi.fn(),
    setIsAuthorized: vi.fn(),
    setQueue: vi.fn(),
    fetchQueue: vi.fn(() => Promise.resolve()),
    ...overrides,
  };
}

describe('usePlayerControls', () => {
  describe('playPause', () => {
    it('pauses when MusicKit is playing (mk === 2)', async () => {
      const provider = createMusicMock({ playbackState: 2 });
      const np = { id: 's1', appleId: 'a1' };
      const refs = createRefs({ provider, queue: { nowPlaying: np, upcoming: [] } });
      const deps = createDeps();
      const { result } = renderHook(() => usePlayerControls(refs, 'V1', deps));

      await act(async () => { await result.current.playPause(); });
      expect(provider.pause).toHaveBeenCalled();
      expect(refs.hasUserGesture).toBe(true);
    });

    it('unblocks autoplay on waitingForGesture', async () => {
      const provider = createMusicMock({ playbackState: 0 });
      const np = { id: 's1', appleId: 'a1' };
      const refs = createRefs({
        provider,
        playerState: PLAYER_STATES.WAITING,
        queue: { nowPlaying: np, upcoming: [] },
      });
      const deps = createDeps();
      const { result } = renderHook(() => usePlayerControls(refs, 'V1', deps));

      await act(async () => { await result.current.playPause(); });
      expect(refs.currentSongId).toBe('s1');
      expect(deps.playSong).toHaveBeenCalledWith(np);
    });

    it('plays new song from paused state when IDs differ', async () => {
      const provider = createMusicMock({ playbackState: 3 });
      const np = { id: 'new', appleId: 'a_new' };
      const refs = createRefs({
        provider,
        currentSongId: 'old',
        queue: { nowPlaying: np, upcoming: [] },
      });
      const deps = createDeps();
      const { result } = renderHook(() => usePlayerControls(refs, 'V1', deps));

      await act(async () => { await result.current.playPause(); });
      expect(deps.playSong).toHaveBeenCalledWith(np);
    });

    it('resumes when paused and same song', async () => {
      const provider = createMusicMock({ playbackState: 3 });
      const np = { id: 's1', appleId: 'a1' };
      const refs = createRefs({
        provider,
        currentSongId: 's1',
        queue: { nowPlaying: np, upcoming: [] },
      });
      const deps = createDeps();
      const { result } = renderHook(() => usePlayerControls(refs, 'V1', deps));

      await act(async () => { await result.current.playPause(); });
      expect(provider.play).toHaveBeenCalled();
      expect(deps.playSong).not.toHaveBeenCalled();
    });

    it('does nothing when provider is null', async () => {
      const refs = createRefs({ provider: null });
      const deps = createDeps();
      const { result } = renderHook(() => usePlayerControls(refs, 'V1', deps));

      await act(async () => { await result.current.playPause(); });
      expect(deps.playSong).not.toHaveBeenCalled();
    });
  });

  describe('skip', () => {
    it('transitions and plays next song without calling stop (iOS safe)', async () => {
      const provider = createMusicMock({ playbackState: 2 });
      const nextSong = { id: 'n1', appleId: 'na1', title: 'Next' };
      const refs = createRefs({
        provider,
        currentSongId: 'c1',
        queue: {
          nowPlaying: { id: 'c1', appleId: 'ca1' },
          upcoming: [nextSong],
        },
      });
      const deps = createDeps();
      const { result } = renderHook(() => usePlayerControls(refs, 'V1', deps));

      await act(async () => { await result.current.skip(); });
      // stop() must NOT be called — setQueue({ startPlaying }) replaces atomically
      expect(provider.stop).not.toHaveBeenCalled();
      expect(deps.beginTransition).toHaveBeenCalled();
      expect(deps.playSong).toHaveBeenCalledWith(nextSong);
      expect(deps.endTransition).toHaveBeenCalled();
      expect(deps.fetchQueue).toHaveBeenCalled();
    });

    it('does not skip when transitioning', async () => {
      const refs = createRefs({
        provider: createMusicMock(),
        playerState: PLAYER_STATES.TRANSITIONING,
      });
      const deps = createDeps();
      const { result } = renderHook(() => usePlayerControls(refs, 'V1', deps));

      await act(async () => { await result.current.skip(); });
      expect(deps.beginTransition).not.toHaveBeenCalled();
    });

    it('does not skip when playLock is held', async () => {
      const refs = createRefs({
        provider: createMusicMock(),
        playLock: true,
      });
      const deps = createDeps();
      const { result } = renderHook(() => usePlayerControls(refs, 'V1', deps));

      await act(async () => { await result.current.skip(); });
      expect(deps.beginTransition).not.toHaveBeenCalled();
    });
  });

  describe('restart', () => {
    it('seeks to 0 and reports to server', async () => {
      const provider = createMusicMock();
      const np = { id: 's1' };
      const refs = createRefs({ provider, queue: { nowPlaying: np, upcoming: [] } });
      const deps = createDeps();
      const { result } = renderHook(() => usePlayerControls(refs, 'V1', deps));

      await act(async () => { await result.current.restart(); });
      expect(provider.seekToTime).toHaveBeenCalledWith(0);
    });
  });

  describe('changeMode', () => {
    it('updates autoplayMode state and ref', async () => {
      const refs = createRefs();
      const deps = createDeps();
      const { result } = renderHook(() => usePlayerControls(refs, 'V1', deps));

      await act(async () => { await result.current.changeMode('random'); });
      expect(result.current.autoplayMode).toBe('random');
      expect(refs.autoplayMode).toBe('random');
    });
  });

  describe('initAutoplayMode', () => {
    it('sets mode without API call', () => {
      const refs = createRefs();
      const deps = createDeps();
      const { result } = renderHook(() => usePlayerControls(refs, 'V1', deps));

      act(() => { result.current.initAutoplayMode('off'); });
      expect(result.current.autoplayMode).toBe('off');
      expect(refs.autoplayMode).toBe('off');
    });
  });

  describe('playPause — mobile error recovery', () => {
    it('AbortError on resume transitions to WAITING (iOS Safari)', async () => {
      const provider = createMusicMock({
        playbackState: 3,
        play: vi.fn(() => Promise.reject(
          new DOMException('The operation was aborted.', 'AbortError')
        )),
      });
      const np = { id: 's1', appleId: 'a1' };
      const refs = createRefs({
        provider,
        currentSongId: 's1',
        queue: { nowPlaying: np, upcoming: [] },
      });
      const deps = createDeps();
      const { result } = renderHook(() => usePlayerControls(refs, 'V1', deps));

      await act(async () => { await result.current.playPause(); });
      expect(deps.updatePlayerState).toHaveBeenCalledWith(PLAYER_STATES.WAITING);
    });

    it('NotAllowedError on resume transitions to WAITING', async () => {
      const provider = createMusicMock({
        playbackState: 3,
        play: vi.fn(() => Promise.reject(
          new DOMException('The request is not allowed', 'NotAllowedError')
        )),
      });
      const np = { id: 's1', appleId: 'a1' };
      const refs = createRefs({
        provider,
        currentSongId: 's1',
        queue: { nowPlaying: np, upcoming: [] },
      });
      const deps = createDeps();
      const { result } = renderHook(() => usePlayerControls(refs, 'V1', deps));

      await act(async () => { await result.current.playPause(); });
      expect(deps.updatePlayerState).toHaveBeenCalledWith(PLAYER_STATES.WAITING);
    });

    it('"abort" in error message transitions to WAITING', async () => {
      const provider = createMusicMock({
        playbackState: 3,
        play: vi.fn(() => Promise.reject(
          new Error('The play() request was aborted by a new load request')
        )),
      });
      const np = { id: 's1', appleId: 'a1' };
      const refs = createRefs({
        provider,
        currentSongId: 's1',
        queue: { nowPlaying: np, upcoming: [] },
      });
      const deps = createDeps();
      const { result } = renderHook(() => usePlayerControls(refs, 'V1', deps));

      await act(async () => { await result.current.playPause(); });
      expect(deps.updatePlayerState).toHaveBeenCalledWith(PLAYER_STATES.WAITING);
    });

    it('generic play error does NOT transition to WAITING', async () => {
      const provider = createMusicMock({
        playbackState: 3,
        play: vi.fn(() => Promise.reject(new Error('MEDIA_ELEMENT_ERROR'))),
      });
      const np = { id: 's1', appleId: 'a1' };
      const refs = createRefs({
        provider,
        currentSongId: 's1',
        queue: { nowPlaying: np, upcoming: [] },
      });
      const deps = createDeps();
      const { result } = renderHook(() => usePlayerControls(refs, 'V1', deps));

      await act(async () => { await result.current.playPause(); });
      expect(deps.updatePlayerState).not.toHaveBeenCalledWith(PLAYER_STATES.WAITING);
    });

    it('sets hasUserGesture on every playPause call (mobile gesture tracking)', async () => {
      const provider = createMusicMock({ playbackState: 0 });
      const refs = createRefs({ provider, queue: { nowPlaying: null, upcoming: [] } });
      const deps = createDeps();
      const { result } = renderHook(() => usePlayerControls(refs, 'V1', deps));

      expect(refs.hasUserGesture).toBe(false);
      await act(async () => { await result.current.playPause(); });
      expect(refs.hasUserGesture).toBe(true);
    });

    it('plays from idle state (mk=0) when nowPlaying exists (cold start on tablet)', async () => {
      const provider = createMusicMock({ playbackState: 0 });
      const np = { id: 's1', appleId: 'a1' };
      const refs = createRefs({
        provider,
        queue: { nowPlaying: np, upcoming: [] },
      });
      const deps = createDeps();
      const { result } = renderHook(() => usePlayerControls(refs, 'V1', deps));

      await act(async () => { await result.current.playPause(); });
      expect(refs.currentSongId).toBe('s1');
      expect(deps.playSong).toHaveBeenCalledWith(np);
    });

    it('plays from ended state (mk=5) — mobile auto-advance recovery', async () => {
      const provider = createMusicMock({ playbackState: 5 });
      const np = { id: 's1', appleId: 'a1' };
      const refs = createRefs({
        provider,
        queue: { nowPlaying: np, upcoming: [] },
      });
      const deps = createDeps();
      const { result } = renderHook(() => usePlayerControls(refs, 'V1', deps));

      await act(async () => { await result.current.playPause(); });
      expect(deps.playSong).toHaveBeenCalledWith(np);
    });

    it('plays from stopped state (mk=4) — mobile background return', async () => {
      const provider = createMusicMock({ playbackState: 4 });
      const np = { id: 's1', appleId: 'a1' };
      const refs = createRefs({
        provider,
        queue: { nowPlaying: np, upcoming: [] },
      });
      const deps = createDeps();
      const { result } = renderHook(() => usePlayerControls(refs, 'V1', deps));

      await act(async () => { await result.current.playPause(); });
      expect(deps.playSong).toHaveBeenCalledWith(np);
    });
  });

  describe('authorize — mobile', () => {
    it('sets hasUserGesture before authorizing (preserves gesture chain)', async () => {
      const gestureOrder = [];
      const provider = createMusicMock({
        isAuthorized: false,
        authorize: vi.fn(() => {
          gestureOrder.push(refs.hasUserGesture);
          provider.isAuthorized = true;
          return Promise.resolve();
        }),
      });
      const refs = createRefs({ provider });
      const deps = createDeps();
      const { result } = renderHook(() => usePlayerControls(refs, 'V1', deps));

      await act(async () => { await result.current.authorize(); });
      expect(gestureOrder[0]).toBe(true);
      expect(deps.setIsAuthorized).toHaveBeenCalledWith(true);
    });

    it('shows APPLE_CONNECT error when auth fails and still not authorized', async () => {
      const provider = createMusicMock({
        isAuthorized: false,
        authorize: vi.fn(() => Promise.reject(new Error('User cancelled'))),
      });
      const refs = createRefs({ provider });
      const deps = createDeps();
      const { result } = renderHook(() => usePlayerControls(refs, 'V1', deps));

      await act(async () => { await result.current.authorize(); });
      expect(deps.setErrorWithPriority).toHaveBeenCalledWith(ERRORS.APPLE_CONNECT);
    });
  });
});
