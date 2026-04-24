/**
 * @jest-environment node
 *
 * Integration test for applyLyricsFilter — the async filter that drops songs
 * based on profanity counts in their lyrics. LRCLIB is mocked so no network
 * hits and tests finish in ms.
 */

jest.mock('../utils/lyricsFetch', () => ({
  fetchPlainLyrics: jest.fn(),
}));

const { fetchPlainLyrics } = require('../utils/lyricsFetch');
const { applyLyricsFilter } = require('../utils/appleMusicAPI');
const cache = require('../utils/lyricsCache');

function song(id, overrides = {}) {
  return {
    appleId: id,
    title: `Song ${id}`,
    artist: 'Someone',
    duration: 180,
    isExplicit: false,
    ...overrides,
  };
}

beforeEach(() => {
  jest.resetAllMocks();
  cache.clear();
});

describe('applyLyricsFilter — passthrough when disabled', () => {
  test('returns input unchanged when lyricsFilter is not enabled', async () => {
    fetchPlainLyrics.mockResolvedValue('some fucking lyrics');
    const songs = [song('a'), song('b')];
    const out = await applyLyricsFilter(songs, { settings: {} });
    expect(out).toEqual(songs);
    expect(fetchPlainLyrics).not.toHaveBeenCalled();
  });

  test('returns input unchanged when venue is null', async () => {
    const songs = [song('a')];
    expect(await applyLyricsFilter(songs, null)).toEqual(songs);
    expect(fetchPlainLyrics).not.toHaveBeenCalled();
  });

  test('handles empty input', async () => {
    expect(await applyLyricsFilter([], { settings: { lyricsFilter: true } })).toEqual([]);
  });
});

describe('applyLyricsFilter — dropping based on threshold', () => {
  test('drops songs at/above threshold, keeps clean lyrics', async () => {
    fetchPlainLyrics.mockImplementation(async ({ title }) => {
      if (title === 'Song dirty') return 'fuck this shit';
      return 'la la happy song';
    });
    const songs = [song('clean', { title: 'Song clean' }), song('dirty', { title: 'Song dirty' })];
    const out = await applyLyricsFilter(songs, {
      settings: { lyricsFilter: true, lyricsThreshold: 1, lyricsLanguages: ['en'] },
    });
    expect(out.map((s) => s.appleId)).toEqual(['clean']);
  });

  test('threshold of 3 keeps songs with 1–2 profanities', async () => {
    fetchPlainLyrics.mockImplementation(async ({ title }) => {
      if (title === 'mild') return 'just one shit here';
      if (title === 'dirty') return 'fuck this shit you bitch';
      return 'clean lyrics';
    });
    const songs = [
      song('clean', { title: 'clean' }),
      song('mild', { title: 'mild' }),
      song('dirty', { title: 'dirty' }),
    ];
    const out = await applyLyricsFilter(songs, {
      settings: { lyricsFilter: true, lyricsThreshold: 3, lyricsLanguages: ['en'] },
    });
    expect(out.map((s) => s.appleId).sort()).toEqual(['clean', 'mild']);
  });

  test('Afrikaans pack catches Afrikaans profanity', async () => {
    fetchPlainLyrics.mockImplementation(async ({ title }) => {
      if (title === 'en_dirty') return 'what the fuck';
      if (title === 'af_dirty') return 'jou fokken poes';
      return 'neutral';
    });
    const songs = [
      song('en_dirty', { title: 'en_dirty' }),
      song('af_dirty', { title: 'af_dirty' }),
      song('clean', { title: 'clean' }),
    ];
    // EN-only pack: drops en_dirty, keeps af_dirty + clean
    const outEn = await applyLyricsFilter(songs, {
      settings: { lyricsFilter: true, lyricsThreshold: 1, lyricsLanguages: ['en'] },
    });
    expect(outEn.map((s) => s.appleId).sort()).toEqual(['af_dirty', 'clean']);

    // Both packs: drops both dirty songs, keeps only clean
    cache.clear();
    const outBoth = await applyLyricsFilter(songs, {
      settings: { lyricsFilter: true, lyricsThreshold: 1, lyricsLanguages: ['en', 'af'] },
    });
    expect(outBoth.map((s) => s.appleId)).toEqual(['clean']);
  });
});

describe('applyLyricsFilter — lyrics-not-found behaviour', () => {
  test('missing lyrics are kept in non-strict mode', async () => {
    fetchPlainLyrics.mockResolvedValue(null);
    const songs = [song('a')];
    const out = await applyLyricsFilter(songs, {
      settings: { lyricsFilter: true, lyricsThreshold: 1 },
    });
    expect(out.map((s) => s.appleId)).toEqual(['a']);
  });

  test('missing lyrics are dropped under strict mode', async () => {
    fetchPlainLyrics.mockResolvedValue(null);
    const songs = [song('a'), song('b')];
    const out = await applyLyricsFilter(songs, {
      settings: { lyricsFilter: true, lyricsThreshold: 1, strictExplicit: true },
    });
    expect(out).toEqual([]);
  });
});

describe('applyLyricsFilter — caching', () => {
  test('does not re-fetch the same song on repeat calls', async () => {
    fetchPlainLyrics.mockResolvedValue('happy song la la');
    const songs = [song('a'), song('b')];
    const venue = { settings: { lyricsFilter: true, lyricsThreshold: 1, lyricsLanguages: ['en'] } };

    await applyLyricsFilter(songs, venue);
    await applyLyricsFilter(songs, venue);

    // Two songs, first call fetches both, second call hits cache for both → total 2 fetches.
    expect(fetchPlainLyrics).toHaveBeenCalledTimes(2);
  });

  test('different language packs trigger a fresh fetch', async () => {
    // First language pack caches under a different key, but the lyrics
    // TEXT is the same — mock returns the same value, counts differ.
    fetchPlainLyrics.mockResolvedValue('fucking poes');
    const songs = [song('a')];

    await applyLyricsFilter(songs, {
      settings: { lyricsFilter: true, lyricsThreshold: 1, lyricsLanguages: ['en'] },
    });
    await applyLyricsFilter(songs, {
      settings: { lyricsFilter: true, lyricsThreshold: 1, lyricsLanguages: ['af'] },
    });

    // Separate cache entries per language set → two fetches total
    expect(fetchPlainLyrics).toHaveBeenCalledTimes(2);
  });
});

describe('applyLyricsFilter — parallelism', () => {
  test('fetches songs concurrently (bounded by pool)', async () => {
    const start = Date.now();
    fetchPlainLyrics.mockImplementation(() =>
      new Promise((resolve) => setTimeout(() => resolve('clean song'), 30)),
    );
    const songs = Array.from({ length: 12 }, (_, i) => song(`s${i}`));
    await applyLyricsFilter(songs, {
      settings: { lyricsFilter: true, lyricsThreshold: 1, lyricsLanguages: ['en'] },
    });
    const elapsed = Date.now() - start;
    // Serial would be 12 * 30 = 360 ms. With pool of 6 → ≤ 2 * 30 = 60 ms + overhead.
    // Assert under 200 ms to leave generous slack for CI variance.
    expect(elapsed).toBeLessThan(200);
  });
});
