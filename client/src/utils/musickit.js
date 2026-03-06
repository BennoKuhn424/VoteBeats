/**
 * MusicKit JS integration for Speeldit.
 * Fetches developer token from backend and configures MusicKit.
 */

const API_URL = import.meta.env.VITE_API_URL || '/api';

let musicInstance = null;
let configurePromise = null;

/**
 * Fetches developer token from backend and configures MusicKit.
 * Returns the MusicKit instance when ready.
 * @returns {Promise<object|null>} MusicKit instance or null if not configured
 */
export async function initMusicKit() {
  if (musicInstance) return musicInstance;
  if (configurePromise) return configurePromise;

  configurePromise = (async () => {
    const MusicKit = window.MusicKit;
    if (!MusicKit) {
      console.warn('MusicKit JS not loaded');
      return null;
    }

    try {
      const res = await fetch(`${API_URL}/token`);
      const data = await res.json();
      const developerToken = data?.developerToken;

      if (!developerToken) {
        console.warn('No Apple Music token available:', data?.error || 'Unknown error');
        return null;
      }

      await MusicKit.configure({
        developerToken,
        app: {
          name: 'Speeldit',
          build: '1.0',
        },
        // Explicitly disable preview-only mode so full songs play (requires Apple Music subscription)
        previewOnly: false,
      });

      musicInstance = MusicKit.getInstance();
      return musicInstance;
    } catch (err) {
      console.error('MusicKit init failed:', err);
      return null;
    }
  })();

  return configurePromise;
}

/**
 * Gets the MusicKit instance. Must call initMusicKit() first.
 */
export function getMusicInstance() {
  return musicInstance;
}

/**
 * Clears MusicKit auth so the user must sign in again. Ensures full playback with subscriber account.
 */
export function unauthorizeMusicKit() {
  if (musicInstance?.unauthorize) {
    return musicInstance.unauthorize();
  }
  return Promise.resolve();
}
