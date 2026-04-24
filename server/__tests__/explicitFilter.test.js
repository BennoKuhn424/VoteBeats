/**
 * @jest-environment node
 *
 * Unit tests for the venue-level content filters in appleMusicAPI.js.
 * These are pure function tests — no HTTP, no DB, no server startup.
 *
 * Covers:
 *   - Default timezone (Africa/Johannesburg) for explicitAfterHour when
 *     settings.timezone isn't set.
 *   - Strict explicit mode (drops songs where contentRating is unknown).
 *   - blockedTitleWords word-boundary matching on title + artist.
 */

jest.mock('../utils/appleMusicToken', () => ({
  getDeveloperToken: jest.fn().mockReturnValue(null),
  getToken: jest.fn().mockReturnValue(null),
}));

const {
  filterByVenueSettings,
  shouldDropForExplicit,
  haystackContainsWord,
  getVenueLocalHour,
} = require('../utils/appleMusicAPI');

function song(overrides = {}) {
  return {
    appleId: 'a1',
    title: 'Clean Song',
    artist: 'Clean Artist',
    albumArt: '',
    duration: 200,
    genre: 'Pop',
    isExplicit: false,
    ...overrides,
  };
}

describe('shouldDropForExplicit', () => {
  test('drops explicit in non-strict', () => {
    expect(shouldDropForExplicit({ isExplicit: true }, false)).toBe(true);
  });

  test('keeps clean in non-strict', () => {
    expect(shouldDropForExplicit({ isExplicit: false }, false)).toBe(false);
  });

  test('keeps unknown in non-strict', () => {
    expect(shouldDropForExplicit({ isExplicit: null }, false)).toBe(false);
    expect(shouldDropForExplicit({ isExplicit: undefined }, false)).toBe(false);
  });

  test('drops explicit and unknown in strict', () => {
    expect(shouldDropForExplicit({ isExplicit: true }, true)).toBe(true);
    expect(shouldDropForExplicit({ isExplicit: null }, true)).toBe(true);
    expect(shouldDropForExplicit({ isExplicit: undefined }, true)).toBe(true);
  });

  test('still keeps confirmed-clean in strict', () => {
    expect(shouldDropForExplicit({ isExplicit: false }, true)).toBe(false);
  });
});

describe('haystackContainsWord — word boundary', () => {
  test('matches whole word case-insensitively', () => {
    expect(haystackContainsWord('Love Song', 'love')).toBe(true);
    expect(haystackContainsWord('LOVE SONG', 'love')).toBe(true);
  });

  test("doesn't match substrings (Scunthorpe)", () => {
    expect(haystackContainsWord('Classic', 'ass')).toBe(false);
    expect(haystackContainsWord('Bass Drop', 'ass')).toBe(false);
    expect(haystackContainsWord('Sussex', 'sex')).toBe(false);
  });

  test('matches across punctuation', () => {
    expect(haystackContainsWord('Hip-Hop, Baby!', 'baby')).toBe(true);
    expect(haystackContainsWord("I'm love-struck", 'love')).toBe(true);
  });

  test('ignores empty inputs', () => {
    expect(haystackContainsWord('', 'x')).toBe(false);
    expect(haystackContainsWord('Something', '')).toBe(false);
    expect(haystackContainsWord('Something', '   ')).toBe(false);
  });

  test('escapes regex metacharacters in the word (treats them as literals)', () => {
    // `.` as a blocked word should match a literal dot, not every character.
    expect(haystackContainsWord('abc', '.')).toBe(false);
    expect(haystackContainsWord('a.b song', '.')).toBe(true); // literal dot exists
    // `(remix)` as a literal phrase should not blow up as a regex group.
    expect(haystackContainsWord('track (remix)', '(remix)')).toBe(false); // not word-bounded
  });
});

describe('getVenueLocalHour — default timezone', () => {
  test('uses Africa/Johannesburg when settings.timezone is missing', () => {
    const venue = { settings: {} };
    const hour = getVenueLocalHour(venue);
    const sastHour = parseInt(
      new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Africa/Johannesburg',
        hour: 'numeric',
        hour12: false,
      })
        .formatToParts(new Date())
        .find((p) => p.type === 'hour').value,
      10,
    );
    expect(hour).toBe(sastHour);
  });

  test('honours a valid IANA timezone when provided', () => {
    const venue = { settings: { timezone: 'UTC' } };
    const hour = getVenueLocalHour(venue);
    expect(hour).toBe(new Date().getUTCHours());
  });

  test('falls back to server clock when timezone is invalid', () => {
    const venue = { settings: { timezone: 'Not/AZone' } };
    expect(() => getVenueLocalHour(venue)).not.toThrow();
  });
});

describe('filterByVenueSettings — allowExplicit / strict', () => {
  test('allowExplicit=false drops explicit but keeps unknown', () => {
    const songs = [
      song({ appleId: 'clean', isExplicit: false }),
      song({ appleId: 'exp', isExplicit: true }),
      song({ appleId: 'unk', isExplicit: null }),
    ];
    const venue = { settings: { allowExplicit: false } };
    const out = filterByVenueSettings(songs, venue).map((s) => s.appleId);
    expect(out).toEqual(['clean', 'unk']);
  });

  test('strictExplicit=true also drops unknown', () => {
    const songs = [
      song({ appleId: 'clean', isExplicit: false }),
      song({ appleId: 'exp', isExplicit: true }),
      song({ appleId: 'unk', isExplicit: null }),
    ];
    const venue = { settings: { allowExplicit: false, strictExplicit: true } };
    const out = filterByVenueSettings(songs, venue).map((s) => s.appleId);
    expect(out).toEqual(['clean']);
  });

  test('allowExplicit=true passes everything through', () => {
    const songs = [
      song({ appleId: 'clean', isExplicit: false }),
      song({ appleId: 'exp', isExplicit: true }),
      song({ appleId: 'unk', isExplicit: null }),
    ];
    // No allowExplicit=false and no explicitAfterHour → explicit filter skipped entirely.
    const venue = { settings: { allowExplicit: true } };
    const out = filterByVenueSettings(songs, venue).map((s) => s.appleId);
    expect(out).toEqual(['clean', 'exp', 'unk']);
  });

  test('strictExplicit has no effect when explicit is allowed', () => {
    const songs = [
      song({ appleId: 'exp', isExplicit: true }),
      song({ appleId: 'unk', isExplicit: null }),
    ];
    const venue = { settings: { allowExplicit: true, strictExplicit: true } };
    const out = filterByVenueSettings(songs, venue).map((s) => s.appleId);
    expect(out).toEqual(['exp', 'unk']);
  });
});

describe('filterByVenueSettings — explicitAfterHour window', () => {
  const songs = [
    song({ appleId: 'clean', isExplicit: false }),
    song({ appleId: 'exp', isExplicit: true }),
    song({ appleId: 'unk', isExplicit: null }),
  ];

  test('before cutoff: explicit dropped, unknown kept (non-strict)', () => {
    const venue = {
      settings: {
        explicitAfterHour: 23, // any reasonable clock, we are almost certainly before 23:00 UTC… but assert behavior against current hour.
        timezone: 'UTC',
      },
    };
    const nowUtc = new Date().getUTCHours();
    // Only run meaningful assertion when we can actually be "before" the cutoff.
    if (nowUtc < 23) {
      const out = filterByVenueSettings(songs, venue).map((s) => s.appleId);
      expect(out).toContain('clean');
      expect(out).toContain('unk');
      expect(out).not.toContain('exp');
    }
  });

  test('before cutoff + strict: explicit AND unknown dropped', () => {
    const venue = {
      settings: {
        explicitAfterHour: 23,
        strictExplicit: true,
        timezone: 'UTC',
      },
    };
    const nowUtc = new Date().getUTCHours();
    if (nowUtc < 23) {
      const out = filterByVenueSettings(songs, venue).map((s) => s.appleId);
      expect(out).toEqual(['clean']);
    }
  });

  test('cutoff=0: explicit always allowed (current hour >= 0)', () => {
    const venue = {
      settings: {
        explicitAfterHour: 0,
        timezone: 'UTC',
      },
    };
    const out = filterByVenueSettings(songs, venue).map((s) => s.appleId);
    expect(out).toContain('exp');
  });
});

describe('filterByVenueSettings — blockedTitleWords', () => {
  test('blocks whole-word match on title', () => {
    const songs = [
      song({ appleId: 'a', title: 'Love Song' }),
      song({ appleId: 'b', title: 'Hate Song' }),
    ];
    const venue = { settings: { allowExplicit: true, blockedTitleWords: ['hate'] } };
    const out = filterByVenueSettings(songs, venue).map((s) => s.appleId);
    expect(out).toEqual(['a']);
  });

  test('blocks whole-word match on artist', () => {
    const songs = [
      song({ appleId: 'a', artist: 'Taylor Swift' }),
      song({ appleId: 'b', artist: 'Unknown Guy' }),
    ];
    const venue = { settings: { allowExplicit: true, blockedTitleWords: ['Unknown'] } };
    const out = filterByVenueSettings(songs, venue).map((s) => s.appleId);
    expect(out).toEqual(['a']);
  });

  test('avoids the Scunthorpe problem', () => {
    const songs = [
      song({ appleId: 'a', title: 'Classic Vibes' }),
      song({ appleId: 'b', title: 'Bass Drop' }),
    ];
    const venue = { settings: { allowExplicit: true, blockedTitleWords: ['ass'] } };
    const out = filterByVenueSettings(songs, venue).map((s) => s.appleId);
    expect(out).toEqual(['a', 'b']); // neither blocked
  });

  test('case-insensitive matching', () => {
    const songs = [song({ appleId: 'a', title: 'BAD Song' })];
    const venue = { settings: { allowExplicit: true, blockedTitleWords: ['bad'] } };
    expect(filterByVenueSettings(songs, venue)).toHaveLength(0);
  });

  test('empty blockedTitleWords list is a no-op', () => {
    const songs = [song({ appleId: 'a', title: 'Any Song' })];
    const venue = { settings: { allowExplicit: true, blockedTitleWords: [] } };
    expect(filterByVenueSettings(songs, venue)).toHaveLength(1);
  });

  test('multiple words: any match drops the song', () => {
    const songs = [
      song({ appleId: 'a', title: 'Hate You' }),
      song({ appleId: 'b', title: 'Evil Eye' }),
      song({ appleId: 'c', title: 'Sunshine' }),
    ];
    const venue = { settings: { allowExplicit: true, blockedTitleWords: ['hate', 'evil'] } };
    const out = filterByVenueSettings(songs, venue).map((s) => s.appleId);
    expect(out).toEqual(['c']);
  });
});

describe('filterByVenueSettings — filter composition', () => {
  test('explicit + blocked words stack', () => {
    const songs = [
      song({ appleId: 'clean_ok', isExplicit: false, title: 'Happy' }),
      song({ appleId: 'clean_blocked', isExplicit: false, title: 'Hate Song' }),
      song({ appleId: 'exp_ok', isExplicit: true, title: 'Happy' }),
    ];
    const venue = {
      settings: {
        allowExplicit: false,
        blockedTitleWords: ['hate'],
      },
    };
    const out = filterByVenueSettings(songs, venue).map((s) => s.appleId);
    expect(out).toEqual(['clean_ok']);
  });

  test('no settings means no filtering', () => {
    const songs = [song({ isExplicit: true, title: 'Evil' })];
    expect(filterByVenueSettings(songs, {})).toEqual(songs);
  });
});
