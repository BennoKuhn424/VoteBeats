/**
 * Tests for advanceToNextSong.
 *
 * The database module is fully mocked so no JSON files are touched.
 */

jest.mock('../utils/database');
const db = require('../utils/database');
const { advanceToNextSong } = require('../utils/queueAdvance');

const VENUE = 'TEST01';

function makeQueue(nowPlaying, upcoming = []) {
  return { nowPlaying, upcoming };
}

function makeSong(id, extra = {}) {
  return { id, appleId: `apple_${id}`, title: `Song ${id}`, ...extra };
}

beforeEach(() => {
  jest.resetAllMocks();
  db.updateQueue.mockImplementation(() => {});
});

describe('advanceToNextSong — expectedSongId guard', () => {
  test('advances when expectedSongId matches nowPlaying.id', () => {
    const current = makeSong('s1');
    const next = makeSong('s2');
    db.getQueue.mockReturnValue(makeQueue(current, [next]));

    advanceToNextSong(VENUE, 's1');

    expect(db.updateQueue).toHaveBeenCalledWith(VENUE, expect.objectContaining({
      nowPlaying: expect.objectContaining({ id: 's2' }),
      upcoming: [],
    }));
  });

  test('does NOT advance when expectedSongId does not match nowPlaying.id (race guard)', () => {
    // Simulates /skip running first — nowPlaying is already s2
    const current = makeSong('s2');
    db.getQueue.mockReturnValue(makeQueue(current, []));

    advanceToNextSong(VENUE, 's1'); // stale ID from the client

    expect(db.updateQueue).not.toHaveBeenCalled();
  });

  test('does NOT advance when nowPlaying is null but a songId is given (stale advance)', () => {
    // Queue already empty — /advance should be a no-op
    db.getQueue.mockReturnValue(makeQueue(null, []));

    advanceToNextSong(VENUE, 's1');

    expect(db.updateQueue).not.toHaveBeenCalled();
  });

  test('advances without expectedSongId (legacy / unconditional advance)', () => {
    const current = makeSong('s1');
    const next = makeSong('s2');
    db.getQueue.mockReturnValue(makeQueue(current, [next]));

    advanceToNextSong(VENUE); // no expectedSongId

    expect(db.updateQueue).toHaveBeenCalledWith(VENUE, expect.objectContaining({
      nowPlaying: expect.objectContaining({ id: 's2' }),
    }));
  });
});

describe('advanceToNextSong — queue transitions', () => {
  test('sets nowPlaying to null when upcoming is empty', () => {
    const current = makeSong('s1');
    db.getQueue.mockReturnValue(makeQueue(current, []));

    advanceToNextSong(VENUE, 's1');

    expect(db.updateQueue).toHaveBeenCalledWith(VENUE, { nowPlaying: null, upcoming: [] });
  });

  test('pops the first upcoming song as nowPlaying (FIFO)', () => {
    const current = makeSong('s1');
    const next = makeSong('s2');
    const after = makeSong('s3');
    db.getQueue.mockReturnValue(makeQueue(current, [next, after]));

    advanceToNextSong(VENUE, 's1');

    expect(db.updateQueue).toHaveBeenCalledWith(VENUE, expect.objectContaining({
      nowPlaying: expect.objectContaining({ id: 's2' }),
      upcoming: [expect.objectContaining({ id: 's3' })],
    }));
  });

  test('sets anchor fields on the new nowPlaying', () => {
    const before = Date.now();
    const current = makeSong('s1');
    const next = makeSong('s2');
    db.getQueue.mockReturnValue(makeQueue(current, [next]));

    advanceToNextSong(VENUE, 's1');

    const written = db.updateQueue.mock.calls[0][1];
    expect(written.nowPlaying.positionMs).toBe(0);
    expect(written.nowPlaying.positionAnchoredAt).toBeGreaterThanOrEqual(before);
    expect(written.nowPlaying.isPaused).toBe(false);
  });
});
