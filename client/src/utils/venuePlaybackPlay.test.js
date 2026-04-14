import { describe, it, expect, vi } from 'vitest';
import {
  buildPreloadAppleIds,
  runSetQueueThenPlay,
  runStopDelaySetQueuePlay,
  withTimeout,
  PLAY_SET_QUEUE_MS,
  PLAY_START_MS,
} from './venuePlaybackPlay';

function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function createMusicKitMock({ setQueueMs, playMs, stopMs = 0 }) {
  const mock = {
    playbackState: 0,
    setQueue: vi.fn(async () => {
      await delay(setQueueMs);
      // startPlaying: true means MusicKit starts playing during setQueue
      mock.playbackState = 2;
    }),
    play: vi.fn(async () => {
      await delay(playMs);
      mock.playbackState = 2;
    }),
    stop: vi.fn(async () => {
      await delay(stopMs);
      mock.playbackState = 0;
    }),
  };
  return mock;
}

describe('buildPreloadAppleIds', () => {
  it('returns current + up to two upcoming Apple IDs', () => {
    const song = { id: 'n', appleId: '111' };
    const upcoming = [
      { id: 'a', appleId: '222' },
      { id: 'b', appleId: '333' },
      { id: 'c', appleId: '444' },
    ];
    expect(buildPreloadAppleIds(song, upcoming)).toEqual(['111', '222', '333']);
  });

  it('returns [] when song has no appleId', () => {
    expect(buildPreloadAppleIds({ id: 'x' }, [])).toEqual([]);
  });
});

/**
 * 100 cases: mock "setQueue + play" wall time and assert measured duration matches.
 * Real MusicKit is not available in CI; this locks down the async contract and timeouts.
 */
describe('runSetQueueThenPlay — 100 timing iterations', () => {
  const indices = Array.from({ length: 100 }, (_, i) => i);
  const generousCap = 15_000;

  it.each(indices)('iteration %i: wall time tracks mock setQueue + play delays', async (i) => {
    const setQueueMs = 2 + (i % 25);
    const playMs = 2 + (i % 18);
    const music = createMusicKitMock({ setQueueMs, playMs });

    const t0 = performance.now();
    await runSetQueueThenPlay(music, ['a', 'b'], { setQueueMs: generousCap, playMs: generousCap });
    const elapsed = performance.now() - t0;

    expect(music.setQueue).toHaveBeenCalledWith({ songs: ['a', 'b'], startPlaying: true });
    // play() is skipped when startPlaying already set playbackState to 2
    expect(music.play).not.toHaveBeenCalled();
    expect(elapsed).toBeGreaterThanOrEqual(setQueueMs - 2);
    expect(elapsed).toBeLessThan(setQueueMs + 100);
  });
});

describe('runStopDelaySetQueuePlay (first-tap path, mocked)', () => {
  it('chains stop + post-delay + setQueue (with startPlaying)', async () => {
    const music = {
      playbackState: 2,
      stop: vi.fn(async () => {
        await delay(4);
        music.playbackState = 0;
      }),
      setQueue: vi.fn(async () => {
        await delay(5);
        music.playbackState = 2; // startPlaying kicks in
      }),
      play: vi.fn(async () => {
        await delay(3);
      }),
    };
    const t0 = performance.now();
    await runStopDelaySetQueuePlay(
      music,
      { song: { appleId: 'x', id: '1' }, upcoming: [] },
      { setQueueMs: 10_000, playMs: 10_000, postStopDelayMs: 0 },
    );
    const elapsed = performance.now() - t0;
    expect(music.stop).toHaveBeenCalled();
    // play() skipped because startPlaying already set state to 2
    expect(music.play).not.toHaveBeenCalled();
    expect(elapsed).toBeGreaterThanOrEqual(4 + 5 - 2);
    expect(elapsed).toBeLessThan(4 + 5 + 120);
  });
});

describe('withTimeout / failure modes', () => {
  it('runSetQueueThenPlay aborts when setQueue hangs past cap', async () => {
    const music = {
      playbackState: 0,
      setQueue: vi.fn(() => new Promise(() => {})),
      play: vi.fn(),
    };
    await expect(
      runSetQueueThenPlay(music, ['z'], { setQueueMs: 45, playMs: 5000 }),
    ).rejects.toThrow(/Timeout after 45ms/);
    expect(music.play).not.toHaveBeenCalled();
  });

  it('production caps are ordered so setQueue + play fits under typical watchdog budget', () => {
    expect(PLAY_SET_QUEUE_MS + PLAY_START_MS).toBeLessThan(60_000);
  });
});
