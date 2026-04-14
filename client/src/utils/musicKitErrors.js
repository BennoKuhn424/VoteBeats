/**
 * Classify MusicKit / WebKit playback errors into categories that drive
 * the player state machine. Extracted as a pure function so browser-specific
 * regressions (iOS Safari, Firefox autoplay, etc.) can be locked in with tests.
 *
 * Categories:
 *   'gesture'       — need a fresh user tap (WAITING state, no error banner)
 *   'drm_key'       — stale Music User Token (unauthorize + DRM_KEY banner)
 *   'media_session' — iOS audio session failed to activate (WAITING, retry by tap)
 *   'network'       — timeout / offline (SLOW_INTERNET / NO_INTERNET banner)
 *   'generic'       — unknown playback failure (PLAYBACK_FAILED banner)
 */
export function classifyPlaybackError(err) {
  if (!err) return 'generic';
  const reason = String(err.reason || '').toUpperCase();
  const name = String(err.name || '');
  const msg = String(err.message || err.errorCode || err.description || '').toLowerCase();

  // iOS Safari audio-session activation failures — need a fresh user gesture
  if (reason === 'MEDIA_SESSION' || msg.includes('media_session')) {
    return 'media_session';
  }

  // Browser autoplay / gesture policies — transition to WAITING
  if (
    name === 'NotAllowedError' ||
    name === 'AbortError' ||
    msg.includes('interact') ||
    msg.includes('abort') ||
    msg.includes('user gesture')
  ) {
    return 'gesture';
  }

  // Network / timeout
  if (msg.includes('timeout') || (typeof navigator !== 'undefined' && navigator.onLine === false)) {
    return 'network';
  }

  // DRM / EME key session failures (incl. iOS Safari dispatchKeyError TypeError{})
  if (
    reason.includes('KEY') ||
    reason.includes('DRM') ||
    msg.includes('key') ||
    msg.includes('drm') ||
    msg.includes('media_key') ||
    msg.includes('decrypt') ||
    msg.includes('license') ||
    name === 'TypeError'
  ) {
    return 'drm_key';
  }

  return 'generic';
}
