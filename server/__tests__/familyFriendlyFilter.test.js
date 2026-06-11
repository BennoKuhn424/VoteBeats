/**
 * @jest-environment node
 *
 * Unit tests for the family-friendly swear filtering in appleMusicAPI:
 *   - filterByVenueSettings: instant explicit-flag + title/artist profanity drop
 *   - applyLyricsFilter: deep lyric scan for the survivors (unrated songs only)
 */

jest.mock('../utils/lyricsFetch', () => ({ fetchPlainLyrics: jest.fn() }));

const { fetchPlainLyrics } = require('../utils/lyricsFetch');
const { filterByVenueSettings, applyLyricsFilter } = require('../utils/appleMusicAPI');

const ff = (extra = {}) => ({ settings: { familyFriendly: true, ...extra } });

describe('filterByVenueSettings — family-friendly (instant)', () => {
  test('drops Apple-flagged explicit songs, keeps clean and unrated', () => {
    const songs = [
      { appleId: '1', title: 'Clean Song', artist: 'A', isExplicit: false },
      { appleId: '2', title: 'Dirty Song', artist: 'B', isExplicit: true },
      { appleId: '3', title: 'Unrated Song', artist: 'C', isExplicit: null },
    ];
    // explicit dropped; unrated kept here (the lyric scan decides on it later).
    expect(filterByVenueSettings(songs, ff()).map((s) => s.appleId)).toEqual(['1', '3']);
  });

  test('drops songs with profanity in the title or artist (EN + AF)', () => {
    const songs = [
      { appleId: '1', title: 'Lovely Day', artist: 'Bill Withers', isExplicit: false },
      { appleId: '2', title: 'Fuck the World', artist: 'X', isExplicit: null },
      { appleId: '3', title: 'Nice One', artist: 'DJ Shit', isExplicit: false },
      { appleId: '4', title: 'Poes Anthem', artist: 'Y', isExplicit: false }, // Afrikaans
    ];
    expect(filterByVenueSettings(songs, ff()).map((s) => s.appleId)).toEqual(['1']);
  });

  test('does not filter when family-friendly is off', () => {
    const songs = [{ appleId: '2', title: 'Dirty', artist: 'B', isExplicit: true }];
    expect(filterByVenueSettings(songs, { settings: {} })).toHaveLength(1);
  });
});

describe('applyLyricsFilter — family-friendly (deep lyric scan)', () => {
  beforeEach(() => jest.clearAllMocks());

  test('drops an unrated song whose lyrics contain a swear', async () => {
    fetchPlainLyrics.mockResolvedValue('la la fuck la la');
    const songs = [{ appleId: 'L1', title: 'Sneaky', artist: 'A', isExplicit: null }];
    expect(await applyLyricsFilter(songs, ff())).toHaveLength(0);
  });

  test('keeps an unrated song with clean lyrics', async () => {
    fetchPlainLyrics.mockResolvedValue('sunshine and rainbows everywhere we go');
    const songs = [{ appleId: 'L2', title: 'Happy', artist: 'A', isExplicit: null }];
    expect(await applyLyricsFilter(songs, ff())).toHaveLength(1);
  });

  test('trusts Apple-clean songs — no lyric fetch for isExplicit === false', async () => {
    const songs = [{ appleId: 'L3', title: 'Trusted', artist: 'A', isExplicit: false }];
    expect(await applyLyricsFilter(songs, ff())).toHaveLength(1);
    expect(fetchPlainLyrics).not.toHaveBeenCalled();
  });

  test('removes an UNRATED song with no lyrics (unknown = risky)', async () => {
    // Apple rating null + LRCLIB has nothing → can't verify → drop in FF mode.
    fetchPlainLyrics.mockResolvedValue(null);
    const songs = [{ appleId: 'L4', title: 'Obscure', artist: 'A', isExplicit: null }];
    expect(await applyLyricsFilter(songs, ff())).toHaveLength(0);
  });

  test('keeps an Apple-CLEAN song even with no lyrics (rating is enough)', async () => {
    fetchPlainLyrics.mockResolvedValue(null);
    const songs = [{ appleId: 'L4b', title: 'Instrumental', artist: 'A', isExplicit: false }];
    const out = await applyLyricsFilter(songs, ff());
    expect(out).toHaveLength(1);
    expect(fetchPlainLyrics).not.toHaveBeenCalled(); // clean songs are never fetched
  });

  test('passes through entirely when family-friendly is off', async () => {
    const songs = [{ appleId: 'L5', title: 'x', artist: 'A', isExplicit: null }];
    expect(await applyLyricsFilter(songs, { settings: {} })).toHaveLength(1);
    expect(fetchPlainLyrics).not.toHaveBeenCalled();
  });
});

describe('applyLyricsFilter — performance (cannot take ages)', () => {
  const ORIGINAL_BUDGET = process.env.LYRIC_SCAN_BUDGET_MS;
  afterEach(() => {
    if (ORIGINAL_BUDGET === undefined) delete process.env.LYRIC_SCAN_BUDGET_MS;
    else process.env.LYRIC_SCAN_BUDGET_MS = ORIGINAL_BUDGET;
    jest.clearAllMocks();
  });

  test('honours the time budget when LRCLIB is slow — bounded, not 40×fetch', async () => {
    process.env.LYRIC_SCAN_BUDGET_MS = '50'; // tiny budget for the test
    // Every fetch is slow (200ms ≫ the 50ms budget).
    fetchPlainLyrics.mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve('clean happy lyrics here'), 200))
    );
    const songs = Array.from({ length: 40 }, (_, i) => ({
      appleId: `slow${i}`, title: `T${i}`, artist: 'A', isExplicit: null,
    }));

    const start = Date.now();
    const out = await applyLyricsFilter(songs, ff());
    const elapsed = Date.now() - start;

    // Only the first concurrent batch starts before the budget expires; the rest
    // are never fetched. So this is ONE ~200ms batch, never 40×200ms = 8s.
    expect(fetchPlainLyrics.mock.calls.length).toBeLessThanOrEqual(8);
    expect(elapsed).toBeLessThan(800);
    // Songs not reached in time are kept (graceful degradation, not an empty list).
    expect(out.length).toBeGreaterThan(0);
  });

  test('uses a hard cap by default (no env) so production search stays responsive', async () => {
    // Sanity: with the default budget and instant (cached-style) fetches, a big
    // result set still resolves immediately.
    fetchPlainLyrics.mockResolvedValue('clean lyrics');
    const songs = Array.from({ length: 25 }, (_, i) => ({
      appleId: `f${i}`, title: `T${i}`, artist: 'A', isExplicit: null,
    }));
    const start = Date.now();
    await applyLyricsFilter(songs, ff());
    expect(Date.now() - start).toBeLessThan(1000);
  });
});
