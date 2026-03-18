/**
 * Tests for advanceToNextSong.
 *
 * queueRepo is mocked so tests focus purely on the mutation logic
 * (what the mutateFn does with a given queue), not on locking or persistence.
 */

jest.mock('../repos/queueRepo');
const queueRepo = require('../repos/queueRepo');
const { advanceToNextSong } = require('../utils/queueAdvance');

const VENUE = 'TEST01';

function makeSong(id, extra = {}) {
  return { id, appleId: `apple_${id}`, title: `Song ${id}`, ...extra };
}

// Helper: wire queueRepo.update to call mutateFn with inputQueue and return its result.
function setupMock(inputQueue) {
  queueRepo.update.mockImplementation(async (_venueCode, mutateFn) => {
    const result = mutateFn(inputQueue);
    return result ?? inputQueue; // queueRepo returns current queue on no-op
  });
}

beforeEach(() => jest.resetAllMocks());

describe('expectedSongId guard', () => {
  test('advances and returns new queue when expectedSongId matches nowPlaying.id', async () => {
    const inputQueue = { nowPlaying: makeSong('s1'), upcoming: [makeSong('s2')] };
    setupMock(inputQueue);

    const result = await advanceToNextSong(VENUE, 's1');

    expect(result).toMatchObject({
      nowPlaying: expect.objectContaining({ id: 's2' }),
      upcoming: [],
    });
  });

  test('no-op when expectedSongId does not match nowPlaying.id (race guard)', async () => {
    // Simulate /skip having already run — nowPlaying is now s2
    const inputQueue = { nowPlaying: makeSong('s2'), upcoming: [] };
    setupMock(inputQueue);

    // The mutateFn returns null → queueRepo returns current queue unchanged
    queueRepo.update.mockImplementation(async (_v, mutateFn) => {
      const r = mutateFn(inputQueue);
      expect(r).toBeNull(); // guard fired
      return inputQueue;
    });

    await advanceToNextSong(VENUE, 's1');
    expect(queueRepo.update).toHaveBeenCalledTimes(1);
  });

  test('no-op when nowPlaying is null and a songId is given (stale advance)', async () => {
    const inputQueue = { nowPlaying: null, upcoming: [] };
    setupMock(inputQueue);

    queueRepo.update.mockImplementation(async (_v, mutateFn) => {
      const r = mutateFn(inputQueue);
      expect(r).toBeNull();
      return inputQueue;
    });

    await advanceToNextSong(VENUE, 's1');
  });

  test('advances unconditionally when no expectedSongId is given', async () => {
    const inputQueue = { nowPlaying: makeSong('s1'), upcoming: [makeSong('s2')] };
    setupMock(inputQueue);

    const result = await advanceToNextSong(VENUE);

    expect(result).toMatchObject({ nowPlaying: expect.objectContaining({ id: 's2' }) });
  });
});

describe('queue transitions', () => {
  test('sets nowPlaying to null when upcoming is empty', async () => {
    setupMock({ nowPlaying: makeSong('s1'), upcoming: [] });

    const result = await advanceToNextSong(VENUE, 's1');

    expect(result).toEqual({ nowPlaying: null, upcoming: [] });
  });

  test('pops first upcoming song in FIFO order', async () => {
    const inputQueue = {
      nowPlaying: makeSong('s1'),
      upcoming: [makeSong('s2'), makeSong('s3')],
    };
    setupMock(inputQueue);

    const result = await advanceToNextSong(VENUE, 's1');

    expect(result.nowPlaying.id).toBe('s2');
    expect(result.upcoming).toHaveLength(1);
    expect(result.upcoming[0].id).toBe('s3');
  });

  test('sets anchor fields (positionMs=0, positionAnchoredAt, isPaused=false) on new nowPlaying', async () => {
    const before = Date.now();
    const inputQueue = { nowPlaying: makeSong('s1'), upcoming: [makeSong('s2')] };
    setupMock(inputQueue);

    const result = await advanceToNextSong(VENUE, 's1');

    expect(result.nowPlaying.positionMs).toBe(0);
    expect(result.nowPlaying.positionAnchoredAt).toBeGreaterThanOrEqual(before);
    expect(result.nowPlaying.isPaused).toBe(false);
  });
});
