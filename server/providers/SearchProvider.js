/**
 * Abstract search/catalog provider interface.
 *
 * A provider wraps a music service's server-side APIs (search, genre-based
 * autofill, playlist picks, and any client-facing token/credential). Routes
 * should depend on this interface, not on a specific provider's internals,
 * so swapping services (Apple, Spotify, YouTube Music, Tidal, etc.) is a
 * configuration change rather than a code change.
 *
 * Song shape returned by all query methods:
 * {
 *   providerTrackId: string,   // canonical ID from the provider
 *   appleId?: string,          // legacy alias (Apple provider sets this; other providers may omit)
 *   title: string,
 *   artist: string,
 *   albumArt: string,          // URL, may be empty string if unavailable
 *   duration: number,          // seconds
 *   genre: string,             // space-joined tag string for filter matching
 *   isExplicit: boolean
 * }
 */

class SearchProvider {
  /**
   * Provider identifier, e.g. "apple", "spotify". Used by the client factory
   * to pick the matching playback provider.
   * @type {string}
   */
  get name() {
    throw new Error('SearchProvider.name must be overridden');
  }

  /**
   * Free-text search across the provider's catalog, filtered by venue
   * settings (explicit, blocked artists, etc.) when venueCode is supplied.
   * @param {string} query
   * @param {string|null} [venueCode]
   * @returns {Promise<object[]>} Array of songs in the shape documented above.
   */
  // eslint-disable-next-line no-unused-vars
  async search(query, venueCode) {
    throw new Error('SearchProvider.search must be overridden');
  }

  /**
   * Pick a single song for autofill using the venue's selected genres.
   * Implementations may apply language/genre rules, recent-pool dedup, and
   * venue filtering. Returns null if nothing matches.
   * @param {string[]} genres - Full autoplayGenre array from venue.settings
   * @param {string} venueCode
   * @returns {Promise<object|null>}
   */
  // eslint-disable-next-line no-unused-vars
  async searchByGenre(genres, venueCode) {
    throw new Error('SearchProvider.searchByGenre must be overridden');
  }

  /**
   * Pick a single song from a venue's curated playlist for autofill,
   * avoiding recent repeats.
   * @param {object[]} playlist
   * @param {string} venueCode
   * @returns {object|null}
   */
  // eslint-disable-next-line no-unused-vars
  pickFromPlaylist(playlist, venueCode) {
    throw new Error('SearchProvider.pickFromPlaylist must be overridden');
  }

  /**
   * Client-facing credential (e.g. MusicKit JWT, Spotify access token).
   * Returns null if the provider does not expose one or is not configured.
   * @returns {string|null}
   */
  getToken() {
    return null;
  }
}

module.exports = SearchProvider;
