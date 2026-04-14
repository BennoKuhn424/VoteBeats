import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useMediaSession } from './useMediaSession';
import { PLAYER_STATES } from './constants';

// Minimal MediaSession / MediaMetadata stubs for jsdom
class FakeMediaMetadata {
  constructor(init) {
    Object.assign(this, init);
  }
}

function createMediaSession() {
  return {
    playbackState: 'none',
    metadata: null,
    setPositionState: vi.fn(),
    setActionHandler: vi.fn(),
  };
}

function baseProps(overrides = {}) {
  return {
    queue: { nowPlaying: null, upcoming: [] },
    playerState: PLAYER_STATES.IDLE,
    playbackTime: 0,
    playbackDuration: 0,
    playPause: vi.fn(),
    skip: vi.fn(),
    restart: vi.fn(),
    ...overrides,
  };
}

describe('useMediaSession', () => {
  let origMediaSession;
  let origMediaMetadata;
  let session;

  beforeEach(() => {
    origMediaSession = navigator.mediaSession;
    origMediaMetadata = globalThis.MediaMetadata;
    session = createMediaSession();
    Object.defineProperty(navigator, 'mediaSession', { value: session, configurable: true });
    globalThis.MediaMetadata = FakeMediaMetadata;
  });

  afterEach(() => {
    Object.defineProperty(navigator, 'mediaSession', { value: origMediaSession, configurable: true });
    if (origMediaMetadata) globalThis.MediaMetadata = origMediaMetadata;
    else delete globalThis.MediaMetadata;
  });

  it('sets playbackState to "playing" when playing', () => {
    const np = { title: 'Song', artist: 'Artist', albumArt: 'https://img/art.jpg' };
    renderHook(() => useMediaSession(baseProps({
      queue: { nowPlaying: np, upcoming: [] },
      playerState: PLAYER_STATES.PLAYING,
    })));
    expect(session.playbackState).toBe('playing');
  });

  it('sets playbackState to "paused" when paused', () => {
    const np = { title: 'Song', artist: 'Artist' };
    renderHook(() => useMediaSession(baseProps({
      queue: { nowPlaying: np, upcoming: [] },
      playerState: PLAYER_STATES.PAUSED,
    })));
    expect(session.playbackState).toBe('paused');
  });

  it('sets playbackState to "none" when idle', () => {
    renderHook(() => useMediaSession(baseProps({
      playerState: PLAYER_STATES.IDLE,
    })));
    expect(session.playbackState).toBe('none');
  });

  it('sets metadata with artwork when albumArt is provided', () => {
    const np = { title: 'My Song', artist: 'My Artist', albumArt: 'https://img/art.jpg' };
    renderHook(() => useMediaSession(baseProps({
      queue: { nowPlaying: np, upcoming: [] },
      playerState: PLAYER_STATES.PLAYING,
    })));
    expect(session.metadata).not.toBeNull();
    expect(session.metadata.title).toBe('My Song');
    expect(session.metadata.artist).toBe('My Artist');
    expect(session.metadata.artwork).toEqual([{ src: 'https://img/art.jpg', sizes: '512x512' }]);
  });

  it('sets metadata without artwork when albumArt is missing', () => {
    const np = { title: 'Song', artist: 'Artist', albumArt: null };
    renderHook(() => useMediaSession(baseProps({
      queue: { nowPlaying: np, upcoming: [] },
      playerState: PLAYER_STATES.PLAYING,
    })));
    expect(session.metadata.artwork).toEqual([]);
  });

  it('artwork field has no hardcoded type (browser auto-detects)', () => {
    const np = { title: 'Song', artist: 'Artist', albumArt: 'https://img/art.png' };
    renderHook(() => useMediaSession(baseProps({
      queue: { nowPlaying: np, upcoming: [] },
      playerState: PLAYER_STATES.PLAYING,
    })));
    const artwork = session.metadata.artwork[0];
    expect(artwork.type).toBeUndefined();
  });

  it('falls back to metadata without artwork when MediaMetadata throws on artwork', () => {
    // First call throws (simulating artwork load failure), second succeeds
    let callCount = 0;
    globalThis.MediaMetadata = class {
      constructor(init) {
        callCount++;
        if (callCount === 1 && init.artwork?.length) {
          throw new TypeError('Load failed');
        }
        Object.assign(this, init);
      }
    };

    const np = { title: 'Song', artist: 'Artist', albumArt: 'https://bad-url/art.jpg' };
    renderHook(() => useMediaSession(baseProps({
      queue: { nowPlaying: np, upcoming: [] },
      playerState: PLAYER_STATES.PLAYING,
    })));
    // Should have fallen back to the no-artwork version
    expect(session.metadata).not.toBeNull();
    expect(session.metadata.title).toBe('Song');
    expect(session.metadata.artwork).toBeUndefined();
  });

  it('survives when both MediaMetadata calls throw (total failure)', () => {
    globalThis.MediaMetadata = class {
      constructor() { throw new TypeError('Load failed'); }
    };

    const np = { title: 'Song', artist: 'Artist', albumArt: 'https://bad-url/art.jpg' };
    // Should not throw
    expect(() => {
      renderHook(() => useMediaSession(baseProps({
        queue: { nowPlaying: np, upcoming: [] },
        playerState: PLAYER_STATES.PLAYING,
      })));
    }).not.toThrow();
  });

  it('calls setPositionState when playing with valid duration', () => {
    const np = { title: 'Song', artist: 'Artist' };
    renderHook(() => useMediaSession(baseProps({
      queue: { nowPlaying: np, upcoming: [] },
      playerState: PLAYER_STATES.PLAYING,
      playbackTime: 30,
      playbackDuration: 200,
    })));
    expect(session.setPositionState).toHaveBeenCalledWith({
      duration: 200,
      position: 30,
      playbackRate: 1,
    });
  });

  it('clears positionState when not playing', () => {
    const np = { title: 'Song', artist: 'Artist' };
    renderHook(() => useMediaSession(baseProps({
      queue: { nowPlaying: np, upcoming: [] },
      playerState: PLAYER_STATES.PAUSED,
      playbackTime: 10,
      playbackDuration: 200,
    })));
    expect(session.setPositionState).toHaveBeenCalledWith(null);
  });

  it('does not call setPositionState when duration is 0', () => {
    const np = { title: 'Song', artist: 'Artist' };
    renderHook(() => useMediaSession(baseProps({
      queue: { nowPlaying: np, upcoming: [] },
      playerState: PLAYER_STATES.PLAYING,
      playbackTime: 0,
      playbackDuration: 0,
    })));
    // Called with null (the "not playing with valid duration" branch)
    expect(session.setPositionState).toHaveBeenCalledWith(null);
  });

  describe('action handlers', () => {
    it('registers play, pause, previoustrack, nexttrack handlers', () => {
      const props = baseProps();
      renderHook(() => useMediaSession(props));
      const calls = session.setActionHandler.mock.calls.map(([action]) => action);
      expect(calls).toContain('play');
      expect(calls).toContain('pause');
      expect(calls).toContain('previoustrack');
      expect(calls).toContain('nexttrack');
    });

    it('play handler calls playPause', () => {
      const props = baseProps();
      renderHook(() => useMediaSession(props));
      const playHandler = session.setActionHandler.mock.calls.find(([a]) => a === 'play')[1];
      playHandler();
      expect(props.playPause).toHaveBeenCalled();
    });

    it('pause handler calls playPause', () => {
      const props = baseProps();
      renderHook(() => useMediaSession(props));
      const pauseHandler = session.setActionHandler.mock.calls.find(([a]) => a === 'pause')[1];
      pauseHandler();
      expect(props.playPause).toHaveBeenCalled();
    });

    it('nexttrack handler calls skip', () => {
      const props = baseProps();
      renderHook(() => useMediaSession(props));
      const nextHandler = session.setActionHandler.mock.calls.find(([a]) => a === 'nexttrack')[1];
      nextHandler();
      expect(props.skip).toHaveBeenCalled();
    });

    it('previoustrack handler calls restart', () => {
      const props = baseProps();
      renderHook(() => useMediaSession(props));
      const prevHandler = session.setActionHandler.mock.calls.find(([a]) => a === 'previoustrack')[1];
      prevHandler();
      expect(props.restart).toHaveBeenCalled();
    });

    it('cleans up handlers on unmount', () => {
      const props = baseProps();
      const { unmount } = renderHook(() => useMediaSession(props));
      session.setActionHandler.mockClear();
      unmount();
      const nullCalls = session.setActionHandler.mock.calls.filter(([, h]) => h === null);
      expect(nullCalls.length).toBe(4);
    });
  });

  describe('defaults for missing data', () => {
    it('uses "Speeldit" as default title when np.title is empty', () => {
      const np = { title: '', artist: 'Artist', albumArt: null };
      renderHook(() => useMediaSession(baseProps({
        queue: { nowPlaying: np, upcoming: [] },
        playerState: PLAYER_STATES.PLAYING,
      })));
      expect(session.metadata.title).toBe('Speeldit');
    });

    it('uses empty string as default artist when np.artist is missing', () => {
      const np = { title: 'Song', albumArt: null };
      renderHook(() => useMediaSession(baseProps({
        queue: { nowPlaying: np, upcoming: [] },
        playerState: PLAYER_STATES.PLAYING,
      })));
      expect(session.metadata.artist).toBe('');
    });
  });
});
