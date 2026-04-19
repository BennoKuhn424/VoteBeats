/**
 * Search provider factory.
 *
 * Resolves the active provider once from `process.env.MUSIC_PROVIDER`
 * (default: "apple") and caches the instance so every route sees the
 * same object. Unknown values fall back to Apple with a console warning —
 * keeps the server running while making the misconfiguration visible.
 */

const AppleMusicSearchProvider = require('./AppleMusicSearchProvider');

let cached = null;

/**
 * Build the configured SearchProvider instance.
 * Only constructs known providers; add new providers here as they land.
 * @returns {import('./SearchProvider')}
 */
function buildProvider() {
  const name = (process.env.MUSIC_PROVIDER || 'apple').trim().toLowerCase();
  switch (name) {
    case 'apple':
      return new AppleMusicSearchProvider();
    default:
      console.warn(
        `[providers] Unknown MUSIC_PROVIDER="${name}" — falling back to "apple".`
      );
      return new AppleMusicSearchProvider();
  }
}

/**
 * Return the active SearchProvider instance. Cached after first call.
 * @returns {import('./SearchProvider')}
 */
function getProvider() {
  if (!cached) cached = buildProvider();
  return cached;
}

/**
 * Reset the cached provider. Test-only escape hatch; production code should
 * never call this.
 */
function _resetProviderForTests() {
  cached = null;
}

module.exports = { getProvider, _resetProviderForTests };
