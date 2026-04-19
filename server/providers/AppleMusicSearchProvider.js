/**
 * Apple Music implementation of SearchProvider.
 *
 * Thin delegation layer over server/utils/appleMusicAPI.js and
 * server/utils/appleMusicToken.js — no business logic duplicated. All song
 * objects are normalized to include `providerTrackId` alongside the legacy
 * `appleId` field so downstream code can migrate incrementally.
 */

const SearchProvider = require('./SearchProvider');
const {
  searchAppleMusic,
  searchByGenre,
  pickFromPlaylist,
} = require('../utils/appleMusicAPI');
const { getDeveloperToken } = require('../utils/appleMusicToken');

/**
 * Attach `providerTrackId` to a single song (or return null passthrough).
 * Keeps `appleId` populated so Stage A is non-breaking for existing consumers.
 * @param {object|null} song
 * @returns {object|null}
 */
function normalize(song) {
  if (!song || typeof song !== 'object') return song;
  if (song.providerTrackId) return song;
  return { ...song, providerTrackId: song.appleId };
}

class AppleMusicSearchProvider extends SearchProvider {
  get name() {
    return 'apple';
  }

  async search(query, venueCode) {
    const songs = await searchAppleMusic(query, venueCode || null);
    return Array.isArray(songs) ? songs.map(normalize) : [];
  }

  async searchByGenre(genres, venueCode) {
    const song = await searchByGenre(genres, venueCode);
    return normalize(song);
  }

  pickFromPlaylist(playlist, venueCode) {
    return normalize(pickFromPlaylist(playlist, venueCode));
  }

  /**
   * Returns the MusicKit JWT developer token, or the legacy
   * APPLE_MUSIC_DEVELOPER_TOKEN env var if no .p8 key is configured.
   * Null if nothing is set (development mode with mock catalog).
   * @returns {string|null}
   */
  getToken() {
    return getDeveloperToken() || process.env.APPLE_MUSIC_DEVELOPER_TOKEN || null;
  }
}

module.exports = AppleMusicSearchProvider;
