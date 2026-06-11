const { checkRequestAllowed } = require('../utils/requestRules');

const venue = (settings) => ({ settings });

describe('checkRequestAllowed — family-friendly', () => {
  it('rejects an explicit song when family-friendly is on', () => {
    const r = checkRequestAllowed(venue({ familyFriendly: true }), { explicit: true });
    expect(r).not.toBeNull();
    expect(r.status).toBe(400);
    expect(r.body.code).toBe('QUEUE_NOT_FAMILY_FRIENDLY');
  });

  it('allows a clean song when family-friendly is on', () => {
    expect(checkRequestAllowed(venue({ familyFriendly: true }), { explicit: false })).toBeNull();
  });

  it('treats a song with no explicit flag as clean (Apple unrated)', () => {
    expect(checkRequestAllowed(venue({ familyFriendly: true }), { title: 'x' })).toBeNull();
  });

  it('allows explicit songs when family-friendly is off', () => {
    expect(checkRequestAllowed(venue({ familyFriendly: false }), { explicit: true })).toBeNull();
  });
});

describe('checkRequestAllowed — genre restriction', () => {
  it('rejects a song outside the allowed genres', () => {
    const r = checkRequestAllowed(venue({ genreFilters: ['Afrikaans'] }), { genre: 'Pop' });
    expect(r.status).toBe(400);
    expect(r.body.code).toBe('QUEUE_GENRE_NOT_ALLOWED');
    expect(r.body.error).toMatch(/Afrikaans/);
  });

  it('allows a song whose genre matches (case-insensitive, substring)', () => {
    expect(checkRequestAllowed(venue({ genreFilters: ['afrikaans'] }), { genre: 'Afrikaans Pop' })).toBeNull();
  });

  it('rejects a song with no genre info when a genre restriction is set', () => {
    const r = checkRequestAllowed(venue({ genreFilters: ['Afrikaans'] }), { title: 'x' });
    expect(r.body.code).toBe('QUEUE_GENRE_NOT_ALLOWED');
  });

  it('allows any genre when no restriction is set', () => {
    expect(checkRequestAllowed(venue({ genreFilters: [] }), { genre: 'Death Metal' })).toBeNull();
    expect(checkRequestAllowed(venue({}), { genre: 'Death Metal' })).toBeNull();
  });
});

describe('checkRequestAllowed — combined', () => {
  it('enforces family-friendly before genre (explicit rejected even if genre matches)', () => {
    const r = checkRequestAllowed(
      venue({ familyFriendly: true, genreFilters: ['Pop'] }),
      { explicit: true, genre: 'Pop' }
    );
    expect(r.body.code).toBe('QUEUE_NOT_FAMILY_FRIENDLY');
  });

  it('allows a clean, in-genre song under both rules', () => {
    expect(
      checkRequestAllowed(
        venue({ familyFriendly: true, genreFilters: ['Pop'] }),
        { explicit: false, genre: 'Pop' }
      )
    ).toBeNull();
  });

  it('is null-safe for missing venue/settings', () => {
    expect(checkRequestAllowed(null, { explicit: true })).toBeNull();
    expect(checkRequestAllowed({}, { genre: 'Pop' })).toBeNull();
  });
});
