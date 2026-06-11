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

  test('keeps songs when no lyrics are found (does not nuke the catalogue)', async () => {
    fetchPlainLyrics.mockResolvedValue(null);
    const songs = [{ appleId: 'L4', title: 'Obscure', artist: 'A', isExplicit: null }];
    expect(await applyLyricsFilter(songs, ff())).toHaveLength(1);
  });

  test('passes through entirely when family-friendly is off', async () => {
    const songs = [{ appleId: 'L5', title: 'x', artist: 'A', isExplicit: null }];
    expect(await applyLyricsFilter(songs, { settings: {} })).toHaveLength(1);
    expect(fetchPlainLyrics).not.toHaveBeenCalled();
  });
});
