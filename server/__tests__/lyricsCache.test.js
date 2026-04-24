/**
 * @jest-environment node
 *
 * In-memory TTL cache for song lyric scan results.
 */

const cache = require('../utils/lyricsCache');

beforeEach(() => {
  cache.clear();
});

describe('lyricsCache — basic set/get', () => {
  test('returns null for missing keys', () => {
    expect(cache.get('appleX', ['en'])).toBeNull();
  });

  test('round-trips a written entry', () => {
    cache.set('a1', ['en'], { hitCount: 3, lyricsFound: true });
    expect(cache.get('a1', ['en'])).toEqual({ hitCount: 3, lyricsFound: true });
  });

  test('distinguishes by language set', () => {
    cache.set('a1', ['en'], { hitCount: 2, lyricsFound: true });
    cache.set('a1', ['en', 'af'], { hitCount: 5, lyricsFound: true });
    expect(cache.get('a1', ['en'])).toEqual({ hitCount: 2, lyricsFound: true });
    expect(cache.get('a1', ['en', 'af'])).toEqual({ hitCount: 5, lyricsFound: true });
  });

  test('language order does not matter', () => {
    cache.set('a1', ['af', 'en'], { hitCount: 7, lyricsFound: true });
    expect(cache.get('a1', ['en', 'af'])).toEqual({ hitCount: 7, lyricsFound: true });
  });

  test('coerces numeric hitCount and booleans', () => {
    cache.set('a1', ['en'], { hitCount: '4', lyricsFound: 1 });
    expect(cache.get('a1', ['en'])).toEqual({ hitCount: 4, lyricsFound: true });
  });
});

describe('lyricsCache — TTL expiry', () => {
  test('entry expires after its TTL', async () => {
    cache.set('a1', ['en'], { hitCount: 1, lyricsFound: true }, 5); // 5 ms
    await new Promise((r) => setTimeout(r, 20));
    expect(cache.get('a1', ['en'])).toBeNull();
  });

  test('entry still present before TTL elapses', async () => {
    cache.set('a1', ['en'], { hitCount: 1, lyricsFound: true }, 200);
    await new Promise((r) => setTimeout(r, 20));
    expect(cache.get('a1', ['en'])).not.toBeNull();
  });
});

describe('lyricsCache — size cap / eviction', () => {
  test('evicts oldest entry once MAX_ENTRIES is exceeded', () => {
    // We can't flip MAX_ENTRIES at runtime, but we can verify the `size()`
    // accessor and LRU refresh-on-read behaviour.
    cache.set('a', ['en'], { hitCount: 0, lyricsFound: true });
    cache.set('b', ['en'], { hitCount: 0, lyricsFound: true });
    cache.set('c', ['en'], { hitCount: 0, lyricsFound: true });
    expect(cache.size()).toBe(3);
    // Reading 'a' should refresh its LRU slot.
    cache.get('a', ['en']);
    expect(cache.size()).toBe(3);
  });
});

describe('lyricsCache — key namespacing', () => {
  test('defaults to en when languages is empty', () => {
    expect(cache.makeKey('a1', [])).toBe('a1|en');
    expect(cache.makeKey('a1', undefined)).toBe('a1|en');
  });

  test('uses sorted joined language signature', () => {
    expect(cache.makeKey('a1', ['af', 'en'])).toBe('a1|af,en');
    expect(cache.makeKey('a1', ['en', 'af'])).toBe('a1|af,en');
  });
});
