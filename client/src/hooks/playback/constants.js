/**
 * Player state machine constants and error priority map.
 *
 * The player state is a single source of truth — impossible combinations
 * (e.g. playing + transitioning) cannot be represented.
 *
 *   notReady         MusicKit not yet initialised
 *   idle             Ready; nothing loaded or stopped between songs
 *   waitingForGesture Autoplay blocked by browser policy — waiting for a tap
 *   transitioning    Loading a new song (skip / advance / auto-transition)
 *   playing          Actively playing
 *   paused           Paused by user or server
 *
 * playerError (separate) can appear alongside any state — it is a banner
 * notification, not a playback state.
 */
export const PLAYER_STATES = /** @type {const} */ ({
  NOT_READY: 'notReady',
  IDLE: 'idle',
  WAITING: 'waitingForGesture',
  TRANSITIONING: 'transitioning',
  PLAYING: 'playing',
  PAUSED: 'paused',
});

/** Lower number = higher priority. Soft notices never overwrite hard errors. */
export const ERROR_PRIORITY = {
  'No internet connection — check your wifi and tap Retry': 1,
  'Slow or no internet — check your wifi and tap Retry': 1,
  'Could not connect to the music service — tap Retry': 2,
  'Music service session expired — tap Retry to reconnect': 2,
  'Player needs attention — tap to reconnect the music service': 3,
  'Player disconnected — tap to reset': 4,
  'Something went wrong — tap Play to retry': 5,
  'Playback failed — retrying…': 6,
};

/** Known error message constants to avoid string duplication across hooks. */
export const ERRORS = {
  NO_INTERNET: 'No internet connection — check your wifi and tap Retry',
  SLOW_INTERNET: 'Slow or no internet — check your wifi and tap Retry',
  APPLE_CONNECT: 'Could not connect to the music service — tap Retry',
  DRM_KEY: 'Music service session expired — tap Retry to reconnect',
  NEEDS_ATTENTION: 'Player needs attention — tap to reconnect the music service',
  DISCONNECTED: 'Player disconnected — tap to reset',
  GENERIC_RETRY: 'Something went wrong — tap Play to retry',
  PLAYBACK_FAILED: 'Playback failed — retrying…',
};
