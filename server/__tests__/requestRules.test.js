jest.mock('../utils/lyricsFetch', () => ({ fetchPlainLyrics: jest.fn() }));

const { fetchPlainLyrics } = require('../utils/lyricsFetch');
const { checkRequestAllowed } = require('../utils/requestRules');
const lyricsCache = require('../utils/lyricsCache');

const venue = (settings) => ({ settings });

beforeEach(() => {
  jest.clearAllMocks();
  lyricsCache.clear();
});

describe('checkRequestAllowed — family-friendly instant checks (no lyric fetch)', () => {
  it('rejects a label-flagged explicit song', async () => {
    const r = await checkRequestAllowed(venue({ familyFriendly: true }), { rating: 'explicit', explicit: true, appleId: '1' });
    expect(r.body.code).toBe('QUEUE_NOT_FAMILY_FRIENDLY');
    expect(fetchPlainLyrics).not.toHaveBeenCalled();
  });

  it('rejects profanity in the title/artist without fetching lyrics', async () => {
    const r = await checkRequestAllowed(venue({ familyFriendly: true }), { title: 'Fuck You', artist: 'X', rating: 'clean', appleId: '2' });
    expect(r.body.code).toBe('QUEUE_NOT_FAMILY_FRIENDLY');
    expect(fetchPlainLyrics).not.toHaveBeenCalled();
  });

  it('allows an Apple-CLEAN song instantly — no lyric fetch', async () => {
    const r = await checkRequestAllowed(venue({ familyFriendly: true }), { title: 'Riptide', artist: 'Vance Joy', rating: 'clean', appleId: '3' });
    expect(r).toBeNull();
    expect(fetchPlainLyrics).not.toHaveBeenCalled();
  });
});

describe('checkRequestAllowed — family-friendly lyric check (unrated songs)', () => {
  it('allows an unrated song with clean lyrics', async () => {
    fetchPlainLyrics.mockResolvedValue('sunshine and good vibes all day');
    const r = await checkRequestAllowed(venue({ familyFriendly: true }), { title: 'X', artist: 'Y', rating: 'unrated', appleId: '4' });
    expect(r).toBeNull();
    expect(fetchPlainLyrics).toHaveBeenCalledTimes(1);
  });

  it('rejects an unrated song with a swear in the lyrics', async () => {
    fetchPlainLyrics.mockResolvedValue('this is some fucking nonsense');
    const r = await checkRequestAllowed(venue({ familyFriendly: true }), { title: 'X', artist: 'Y', rating: 'unrated', appleId: '5' });
    expect(r.body.code).toBe('QUEUE_NOT_FAMILY_FRIENDLY');
  });

  it('rejects an unrated song when LRCLIB has no lyrics (fail-closed)', async () => {
    fetchPlainLyrics.mockResolvedValue(null);
    const r = await checkRequestAllowed(venue({ familyFriendly: true }), { title: 'Obscure', artist: 'Y', rating: 'unrated', appleId: '6' });
    expect(r.body.code).toBe('QUEUE_NOT_FAMILY_FRIENDLY');
  });

  it('treats a missing rating as unrated and still verifies it', async () => {
    fetchPlainLyrics.mockResolvedValue(null);
    const r = await checkRequestAllowed(venue({ familyFriendly: true }), { title: 'X', artist: 'Y', appleId: '7' });
    expect(r.body.code).toBe('QUEUE_NOT_FAMILY_FRIENDLY');
    expect(fetchPlainLyrics).toHaveBeenCalled();
  });

  it('caches the scan so a repeat request does not re-fetch', async () => {
    fetchPlainLyrics.mockResolvedValue('clean lyrics here we go');
    const song = { title: 'X', artist: 'Y', rating: 'unrated', appleId: '8' };
    await checkRequestAllowed(venue({ familyFriendly: true }), song);
    await checkRequestAllowed(venue({ familyFriendly: true }), song);
    expect(fetchPlainLyrics).toHaveBeenCalledTimes(1);
  });
});

describe('checkRequestAllowed — family-friendly off', () => {
  it('allows explicit songs and never fetches lyrics', async () => {
    const r = await checkRequestAllowed(venue({ familyFriendly: false }), { rating: 'explicit', explicit: true });
    expect(r).toBeNull();
    expect(fetchPlainLyrics).not.toHaveBeenCalled();
  });
});

describe('checkRequestAllowed — genre restriction', () => {
  it('rejects a song outside the allowed genres', async () => {
    const r = await checkRequestAllowed(venue({ genreFilters: ['Afrikaans'] }), { genre: 'Pop' });
    expect(r.body.code).toBe('QUEUE_GENRE_NOT_ALLOWED');
    expect(r.body.error).toMatch(/Afrikaans/);
  });

  it('allows a song whose genre matches (case-insensitive, substring)', async () => {
    expect(await checkRequestAllowed(venue({ genreFilters: ['afrikaans'] }), { genre: 'Afrikaans Pop' })).toBeNull();
  });

  it('allows any genre when no restriction is set', async () => {
    expect(await checkRequestAllowed(venue({}), { genre: 'Death Metal' })).toBeNull();
  });

  it('is null-safe for missing venue/settings', async () => {
    expect(await checkRequestAllowed(null, { explicit: true })).toBeNull();
    expect(await checkRequestAllowed({}, { genre: 'Pop' })).toBeNull();
  });
});

describe('checkRequestAllowed — combined', () => {
  it('enforces family-friendly before genre (explicit rejected even if genre matches)', async () => {
    const r = await checkRequestAllowed(
      venue({ familyFriendly: true, genreFilters: ['Pop'] }),
      { rating: 'explicit', explicit: true, genre: 'Pop' }
    );
    expect(r.body.code).toBe('QUEUE_NOT_FAMILY_FRIENDLY');
  });

  it('allows a clean, in-genre song under both rules', async () => {
    const r = await checkRequestAllowed(
      venue({ familyFriendly: true, genreFilters: ['Pop'] }),
      { rating: 'clean', genre: 'Pop' }
    );
    expect(r).toBeNull();
  });
});
