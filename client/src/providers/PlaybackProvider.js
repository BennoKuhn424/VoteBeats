/**
 * Abstract client-side playback provider interface.
 *
 * Wraps a music-service SDK (Apple MusicKit today; Spotify / YouTube Music
 * tomorrow) so higher-level hooks never touch a specific SDK directly. Every
 * method below is a subclass responsibility unless a default is documented.
 *
 * State shape returned by getCurrentState():
 * {
 *   isPlaying: boolean,
 *   isPaused: boolean,
 *   currentTime: number,         // seconds
 *   duration: number,            // seconds
 *   nowPlayingId: string | null  // provider track ID currently loaded
 * }
 *
 * Error categories emitted by onError listeners / classifyError():
 *   'gesture' | 'drm_key' | 'media_session' | 'network' | 'generic'
 */

export default class PlaybackProvider {
  /**
   * Provider identifier, e.g. "apple". Must match the server's provider name
   * so factories on both sides pick the same implementation.
   * @type {string}
   */
  get name() {
    throw new Error('PlaybackProvider.name must be overridden');
  }

  /**
   * Configure the underlying SDK with the developer/access token from the
   * backend. Safe to call multiple times; implementations should dedupe.
   * @param {string} token
   * @returns {Promise<void>}
   */
  // eslint-disable-next-line no-unused-vars
  async initialize(token) {
    throw new Error('PlaybackProvider.initialize must be overridden');
  }

  /**
   * Prompt the user to grant streaming permission (e.g. MusicKit authorize,
   * Spotify OAuth). Resolves when the user has linked their subscription or
   * rejects/throws if declined.
   * @returns {Promise<boolean>} true if authorized
   */
  async authorize() {
    throw new Error('PlaybackProvider.authorize must be overridden');
  }

  /** Revoke the user's streaming session. */
  async unauthorize() {
    /* default: no-op */
  }

  /** Whether the user is currently authorized to stream. */
  get isAuthorized() {
    return false;
  }

  /**
   * Load and start a list of provider track IDs.
   * @param {string[]} trackIds - ordered list; first ID plays first
   * @returns {Promise<void>}
   */
  // eslint-disable-next-line no-unused-vars
  async play(trackIds) {
    throw new Error('PlaybackProvider.play must be overridden');
  }

  async pause() {
    throw new Error('PlaybackProvider.pause must be overridden');
  }

  async resume() {
    throw new Error('PlaybackProvider.resume must be overridden');
  }

  async skip() {
    throw new Error('PlaybackProvider.skip must be overridden');
  }

  /**
   * Seek to a position in the current track.
   * @param {number} seconds
   */
  // eslint-disable-next-line no-unused-vars
  async seekToTime(seconds) {
    throw new Error('PlaybackProvider.seekToTime must be overridden');
  }

  /**
   * Set output volume.
   * @param {number} level - 0..100
   */
  // eslint-disable-next-line no-unused-vars
  setVolume(level) {
    throw new Error('PlaybackProvider.setVolume must be overridden');
  }

  /** @returns {{ isPlaying: boolean, isPaused: boolean, currentTime: number, duration: number, nowPlayingId: string|null }} */
  getCurrentState() {
    throw new Error('PlaybackProvider.getCurrentState must be overridden');
  }

  /**
   * Subscribe to playback-state changes. Listener receives the same shape as
   * getCurrentState(). Returns an unsubscribe function.
   * @param {(state: object) => void} callback
   * @returns {() => void}
   */
  // eslint-disable-next-line no-unused-vars
  onStateChange(callback) {
    throw new Error('PlaybackProvider.onStateChange must be overridden');
  }

  /**
   * Subscribe to playback errors. Listener receives the raw error; use
   * classifyError() to map it to one of the canonical categories.
   * @param {(err: unknown) => void} callback
   * @returns {() => void}
   */
  // eslint-disable-next-line no-unused-vars
  onError(callback) {
    throw new Error('PlaybackProvider.onError must be overridden');
  }

  /**
   * Reduce a raw SDK error into one of the canonical categories so the hooks
   * can drive the state machine without provider-specific knowledge.
   * @param {unknown} err
   * @returns {'gesture'|'drm_key'|'media_session'|'network'|'generic'}
   */
  // eslint-disable-next-line no-unused-vars
  classifyError(err) {
    return 'generic';
  }

  /** Detach listeners and release resources. */
  destroy() {
    /* default: no-op */
  }
}
