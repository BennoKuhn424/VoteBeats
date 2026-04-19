/**
 * Client-side playback provider factory.
 *
 * Asks the backend which provider it's configured for (via `/api/token`),
 * constructs the matching {@link PlaybackProvider}, and caches it. The
 * provider is not auto-initialized — callers invoke `provider.initialize(token)`
 * so they control when the SDK starts configuring (typically inside the
 * user gesture that also triggers authorization on iOS Safari).
 *
 * Response contract (stable across providers):
 *   { provider: 'apple'|'spotify'|..., developerToken: string|null }
 */

import AppleMusicPlaybackProvider from './AppleMusicPlaybackProvider';
import api from '../utils/api';

let cached = null;

function buildProvider(name) {
  const normalized = String(name || 'apple').trim().toLowerCase();
  switch (normalized) {
    case 'apple':
      return new AppleMusicPlaybackProvider();
    default:
      console.warn(`[providers] Unknown provider "${name}" — falling back to "apple".`);
      return new AppleMusicPlaybackProvider();
  }
}

/**
 * Resolve the active PlaybackProvider. Caches the instance and the token so
 * repeat callers don't trigger extra `/api/token` fetches.
 * @returns {Promise<{ provider: import('./PlaybackProvider').default, token: string|null }>}
 */
export async function resolvePlaybackProvider() {
  if (cached) return cached;

  let token = null;
  let providerName = 'apple';
  try {
    const res = await api.getDeveloperToken();
    token = res?.data?.developerToken || res?.data?.token || null;
    providerName = res?.data?.provider || providerName;
  } catch (err) {
    console.warn('[providers] /api/token lookup failed; defaulting to apple:', err?.message);
  }

  const provider = buildProvider(providerName);
  cached = { provider, token };
  return cached;
}

/**
 * Return the cached provider without fetching. Null until
 * {@link resolvePlaybackProvider} has been awaited at least once.
 * @returns {import('./PlaybackProvider').default | null}
 */
export function getCachedProvider() {
  return cached?.provider || null;
}

/** Test-only escape hatch. Clears the cached provider + token. */
export function _resetProviderForTests() {
  if (cached?.provider?.destroy) {
    try { cached.provider.destroy(); } catch { /* ignore */ }
  }
  cached = null;
}
