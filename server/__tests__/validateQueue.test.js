/**
 * Tests for validateQueue invariant checker.
 * No I/O — validateQueue works on plain objects.
 */

const { validateQueue } = require('../utils/validateQueue');

const VENUE = 'TEST01';

function makeSong(id, extra = {}) {
  return { id, appleId: `apple_${id}`, title: `Song ${id}`, ...extra };
}

describe('validateQueue — valid queues', () => {
  test('returns valid:true for a clean queue', () => {
    const queue = { nowPlaying: makeSong('s1'), upcoming: [makeSong('s2'), makeSong('s3')] };
    const result = validateQueue(VENUE, queue);
    expect(result.valid).toBe(true);
    expect(result.issues).toHaveLength(0);
  });

  test('returns valid:true for empty queue', () => {
    const result = validateQueue(VENUE, { nowPlaying: null, upcoming: [] });
    expect(result.valid).toBe(true);
  });
});

describe('validateQueue — duplicate IDs in upcoming', () => {
  test('removes duplicate IDs and reports an issue', () => {
    const queue = {
      nowPlaying: null,
      upcoming: [makeSong('s1'), makeSong('s2'), makeSong('s1')],
    };
    const result = validateQueue(VENUE, queue);
    expect(result.valid).toBe(false);
    expect(queue.upcoming).toHaveLength(2);
    expect(queue.upcoming.map((s) => s.id)).toEqual(['s1', 's2']);
  });

  test('removes entries with missing id', () => {
    const queue = {
      nowPlaying: null,
      upcoming: [makeSong('s1'), { appleId: 'apple_x', title: 'No ID' }],
    };
    const result = validateQueue(VENUE, queue);
    expect(result.valid).toBe(false);
    expect(queue.upcoming).toHaveLength(1);
    expect(queue.upcoming[0].id).toBe('s1');
  });
});

describe('validateQueue — nowPlaying in upcoming', () => {
  test('removes nowPlaying from upcoming when it appears there too', () => {
    const np = makeSong('s1');
    const queue = {
      nowPlaying: np,
      upcoming: [makeSong('s2'), makeSong('s1')], // s1 appears in both!
    };
    const result = validateQueue(VENUE, queue);
    expect(result.valid).toBe(false);
    expect(queue.upcoming.map((s) => s.id)).toEqual(['s2']);
  });
});

describe('validateQueue — duration bounds', () => {
  test('reports an issue for negative duration', () => {
    const queue = { nowPlaying: { ...makeSong('s1'), duration: -1 }, upcoming: [] };
    const result = validateQueue(VENUE, queue);
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.includes('duration'))).toBe(true);
  });

  test('reports an issue for duration >1 hour', () => {
    const queue = { nowPlaying: { ...makeSong('s1'), duration: 3601 }, upcoming: [] };
    const result = validateQueue(VENUE, queue);
    expect(result.valid).toBe(false);
  });

  test('accepts reasonable duration', () => {
    const queue = { nowPlaying: { ...makeSong('s1'), duration: 210 }, upcoming: [] };
    const result = validateQueue(VENUE, queue);
    expect(result.valid).toBe(true);
  });
});

describe('validateQueue — missing appleId in upcoming', () => {
  test('reports an issue when appleId is missing', () => {
    const queue = {
      nowPlaying: null,
      upcoming: [{ id: 's1', title: 'No Apple ID' }],
    };
    const result = validateQueue(VENUE, queue);
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.includes('appleId'))).toBe(true);
  });
});

describe('validateQueue — null/bad input', () => {
  test('returns valid:false for null queue', () => {
    const result = validateQueue(VENUE, null);
    expect(result.valid).toBe(false);
  });

  test('returns valid:false for non-object', () => {
    const result = validateQueue(VENUE, 'not an object');
    expect(result.valid).toBe(false);
  });
});
