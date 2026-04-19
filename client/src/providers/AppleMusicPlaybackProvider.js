/**
 * Apple Music implementation of PlaybackProvider.
 *
 * Two surfaces live on this class:
 *
 *   1. Abstract API inherited from {@link PlaybackProvider}:
 *      `initialize`, `authorize`, `unauthorize`, `play(trackIds)`, `resume`,
 *      `pause`, `skip`, `seekToTime`, `setVolume`, `getCurrentState`,
 *      `onStateChange`, `onError`, `classifyError`, `destroy`.
 *      Written to be stable across providers (Spotify, YT Music, etc.).
 *
 *   2. SDK-shaped proxy surface for the hook layer:
 *      MusicKit-style getters (`playbackState`, `currentPlaybackTime`,
 *      `nowPlayingItem`, …) and methods (`setQueue`, `play`, `pause`,
 *      `stop`, `skipToNextItem`, `seekToTime`, `authorize`, `unauthorize`,
 *      `addEventListener`, `removeEventListener`, `volume`).
 *      Exists so hooks don't need to rewrite their state-read logic. When
 *      we plug in a non-Apple provider, that provider's implementation of
 *      this proxy surface is responsible for normalizing to MusicKit's
 *      shape (playbackState 0..5, event names, etc.).
 *
 * Thin delegation — no logic duplicated:
 *   - `utils/musickit.js`          → SDK configure / singleton / unauthorize
 *   - `utils/venuePlaybackPlay.js` → setQueue + play sequence
 *   - `utils/musicKitErrors.js`    → error classification
 */

import PlaybackProvider from './PlaybackProvider';
import { initMusicKit, getMusicInstance, unauthorizeMusicKit } from '../utils/musickit';
import { runSetQueueThenPlay, buildPreloadAppleIds } from '../utils/venuePlaybackPlay';
import { classifyPlaybackError } from '../utils/musicKitErrors';

const MUSICKIT_STATE = Object.freeze({
  NONE: 0,
  LOADING: 1,
  PLAYING: 2,
  PAUSED: 3,
  STOPPED: 4,
  ENDED: 5,
});

export default class AppleMusicPlaybackProvider extends PlaybackProvider {
  constructor() {
    super();
    this._music = null;
    this._stateListeners = new Set();
    this._errorListeners = new Set();
    this._mkStateListener = null;
    this._mkErrorListener = null;
    this._mkTimeListener = null;
  }

  get name() {
    return 'apple';
  }

  /**
   * Configure MusicKit. If `token` is provided, configures directly; otherwise
   * delegates to `initMusicKit()` which fetches the token from `/api/token`.
   * @param {string} [token]
   * @returns {Promise<void>}
   */
  async initialize(token) {
    if (this._music) return;

    if (!token) {
      this._music = await initMusicKit();
      if (this._music) this._wireSdkListeners();
      return;
    }

    const MusicKit = typeof window !== 'undefined' ? window.MusicKit : null;
    if (!MusicKit) {
      console.warn('[AppleMusicPlaybackProvider] MusicKit JS not loaded');
      return;
    }
    await MusicKit.configure({
      developerToken: token,
      app: { name: 'Speeldit', build: '1.0' },
      previewOnly: false,
    });
    this._music = MusicKit.getInstance();
    this._wireSdkListeners();
  }

  async authorize() {
    const music = this._resolveMusic();
    if (!music) return false;
    await music.authorize();
    return !!music.isAuthorized;
  }

  async unauthorize() {
    return unauthorizeMusicKit();
  }

  get isAuthorized() {
    const music = this._resolveMusic();
    return !!music?.isAuthorized;
  }

  // ────────────────────────────────────────────────────────────────────
  // Abstract high-level API
  // ────────────────────────────────────────────────────────────────────

  /**
   * @param {string[]} trackIds
   */
  async play(trackIds) {
    // Two call shapes: abstract `play(trackIds)` (load+start), or proxy
    // `play()` (MusicKit's resume). Disambiguate on argument.
    const music = this._resolveMusic();
    if (!music) {
      if (trackIds === undefined) return;
      throw new Error('MusicKit not initialized');
    }
    if (trackIds === undefined) {
      return music.play();
    }
    const ids = Array.isArray(trackIds) ? trackIds.filter(Boolean) : [];
    if (ids.length === 0) return;
    await runSetQueueThenPlay(music, ids);
  }

  async pause() {
    const music = this._resolveMusic();
    if (!music) return;
    return music.pause();
  }

  async resume() {
    const music = this._resolveMusic();
    if (!music) return;
    return music.play();
  }

  async skip() {
    const music = this._resolveMusic();
    if (!music) return;
    return music.skipToNextItem();
  }

  async seekToTime(seconds) {
    const music = this._resolveMusic();
    if (!music) return;
    return music.seekToTime(seconds);
  }

  setVolume(level) {
    const music = this._resolveMusic();
    if (!music) return;
    const clamped = Math.max(0, Math.min(100, Number(level) || 0));
    music.volume = clamped / 100;
  }

  getCurrentState() {
    const music = this._resolveMusic();
    if (!music) {
      return { isPlaying: false, isPaused: false, currentTime: 0, duration: 0, nowPlayingId: null };
    }
    const mk = music.playbackState;
    return {
      isPlaying: mk === MUSICKIT_STATE.PLAYING,
      isPaused: mk === MUSICKIT_STATE.PAUSED,
      currentTime: music.currentPlaybackTime || 0,
      duration: music.currentPlaybackDuration || 0,
      nowPlayingId: music.nowPlayingItem?.id ? String(music.nowPlayingItem.id) : null,
    };
  }

  /**
   * Subscribe to state changes. Listener receives getCurrentState() output.
   * @param {(state: object) => void} callback
   * @returns {() => void}
   */
  onStateChange(callback) {
    if (typeof callback !== 'function') return () => {};
    this._stateListeners.add(callback);
    return () => this._stateListeners.delete(callback);
  }

  /**
   * Subscribe to raw playback errors.
   * @param {(err: unknown) => void} callback
   * @returns {() => void}
   */
  onError(callback) {
    if (typeof callback !== 'function') return () => {};
    this._errorListeners.add(callback);
    return () => this._errorListeners.delete(callback);
  }

  classifyError(err) {
    return classifyPlaybackError(err);
  }

  destroy() {
    const music = this._music;
    if (music) {
      if (this._mkStateListener) music.removeEventListener('playbackStateDidChange', this._mkStateListener);
      if (this._mkTimeListener) music.removeEventListener('playbackTimeDidChange', this._mkTimeListener);
      if (this._mkErrorListener) music.removeEventListener('mediaPlaybackError', this._mkErrorListener);
    }
    this._stateListeners.clear();
    this._errorListeners.clear();
    this._mkStateListener = null;
    this._mkTimeListener = null;
    this._mkErrorListener = null;
  }

  /**
   * Preload helper exposed for callers that need to pass a preload window
   * (current + up to two upcoming tracks) to `play()`.
   * @param {{ providerTrackId?: string, appleId?: string, id: string }} song
   * @param {Array<{ providerTrackId?: string, appleId?: string, id?: string }>} [upcoming]
   * @returns {string[]}
   */
  buildPreloadTrackIds(song, upcoming = []) {
    const appleish = (s) => (s?.providerTrackId || s?.appleId);
    if (!appleish(song)) return [];
    const base = { ...song, appleId: appleish(song) };
    const normalizedUpcoming = upcoming.map((s) => ({ ...s, appleId: appleish(s) }));
    return buildPreloadAppleIds(base, normalizedUpcoming);
  }

  // ────────────────────────────────────────────────────────────────────
  // MusicKit-shaped proxy surface (for hook-layer compatibility)
  // ────────────────────────────────────────────────────────────────────

  get playbackState() { return this._resolveMusic()?.playbackState ?? 0; }
  get currentPlaybackTime() { return this._resolveMusic()?.currentPlaybackTime ?? 0; }
  get currentPlaybackDuration() { return this._resolveMusic()?.currentPlaybackDuration ?? 0; }
  get nowPlayingItem() { return this._resolveMusic()?.nowPlayingItem ?? null; }
  get volume() { return this._resolveMusic()?.volume ?? 0; }
  set volume(v) { const m = this._resolveMusic(); if (m) m.volume = v; }

  /** MusicKit-shaped: setQueue({ songs, startPlaying }). */
  setQueue(opts) {
    const music = this._resolveMusic();
    if (!music) return Promise.resolve();
    return music.setQueue(opts);
  }

  stop() {
    const music = this._resolveMusic();
    if (!music) return Promise.resolve();
    return music.stop();
  }

  skipToNextItem() {
    const music = this._resolveMusic();
    if (!music) return Promise.resolve();
    return music.skipToNextItem();
  }

  /**
   * Forward a listener to the underlying MusicKit instance. Supported event
   * names: `playbackStateDidChange`, `playbackTimeDidChange`,
   * `nowPlayingItemDidChange`, `authorizationStatusDidChange`,
   * `mediaPlaybackError`.
   */
  addEventListener(type, listener) {
    const music = this._resolveMusic();
    if (!music) return;
    music.addEventListener(type, listener);
  }

  removeEventListener(type, listener) {
    const music = this._resolveMusic();
    if (!music) return;
    music.removeEventListener(type, listener);
  }

  // ────────────────────────────────────────────────────────────────────
  // Internals
  // ────────────────────────────────────────────────────────────────────

  _resolveMusic() {
    if (!this._music) this._music = getMusicInstance();
    return this._music;
  }

  _wireSdkListeners() {
    const music = this._music;
    if (!music || this._mkStateListener) return;

    this._mkStateListener = () => {
      const snapshot = this.getCurrentState();
      this._stateListeners.forEach((fn) => {
        try { fn(snapshot); } catch (err) { console.error('[AppleMusicPlaybackProvider] state listener threw:', err); }
      });
    };
    this._mkTimeListener = this._mkStateListener;
    this._mkErrorListener = (evt) => {
      const raw = evt?.error || evt;
      this._errorListeners.forEach((fn) => {
        try { fn(raw); } catch (err) { console.error('[AppleMusicPlaybackProvider] error listener threw:', err); }
      });
    };

    music.addEventListener('playbackStateDidChange', this._mkStateListener);
    music.addEventListener('playbackTimeDidChange', this._mkTimeListener);
    music.addEventListener('mediaPlaybackError', this._mkErrorListener);
  }
}
