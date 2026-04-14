import { describe, it, expect } from 'vitest';
import { classifyPlaybackError } from './musicKitErrors';

/**
 * Regression tests for real browser errors we've seen break the player.
 * Each test case is keyed to a specific error observed in production logs
 * (iOS Safari, Chrome mobile, Firefox).
 */
describe('classifyPlaybackError', () => {
  describe('iOS Safari MEDIA_SESSION regressions', () => {
    it('MKError with reason "MEDIA_SESSION" → media_session', () => {
      const err = { isMKError: true, reason: 'MEDIA_SESSION', description: 'MKError' };
      expect(classifyPlaybackError(err)).toBe('media_session');
    });

    it('lowercase media_session in message → media_session', () => {
      expect(classifyPlaybackError(new Error('MEDIA_SESSION error'))).toBe('media_session');
    });

    it('reason takes precedence even when name is TypeError', () => {
      const err = Object.assign(new TypeError('{}'), { reason: 'MEDIA_SESSION' });
      expect(classifyPlaybackError(err)).toBe('media_session');
    });
  });

  describe('iOS Safari dispatchKeyError TypeError{} regressions', () => {
    it('empty TypeError {} → drm_key (MEDIA_KEY dispatchKeyError)', () => {
      expect(classifyPlaybackError(new TypeError())).toBe('drm_key');
    });

    it('MKError reason "KEY_ERROR" → drm_key', () => {
      expect(classifyPlaybackError({ reason: 'KEY_ERROR' })).toBe('drm_key');
    });

    it('"license expired" message → drm_key', () => {
      expect(classifyPlaybackError(new Error('license expired'))).toBe('drm_key');
    });
  });

  describe('autoplay / gesture policy (Chrome, Firefox, Safari desktop)', () => {
    it('NotAllowedError → gesture', () => {
      expect(classifyPlaybackError(new DOMException('nope', 'NotAllowedError'))).toBe('gesture');
    });

    it('AbortError → gesture', () => {
      expect(classifyPlaybackError(new DOMException('aborted', 'AbortError'))).toBe('gesture');
    });

    it('"user must interact with the page first" → gesture', () => {
      expect(classifyPlaybackError(new Error('User must interact with the page first'))).toBe('gesture');
    });

    it('"the play() request was aborted" (Safari wording) → gesture', () => {
      expect(classifyPlaybackError(new Error('The play() request was aborted by a new load request'))).toBe('gesture');
    });
  });

  describe('network / timeout', () => {
    it('"Timeout after 28000ms" → network', () => {
      expect(classifyPlaybackError(new Error('Timeout after 28000ms'))).toBe('network');
    });
  });

  describe('generic', () => {
    it('unknown codec error → generic', () => {
      expect(classifyPlaybackError(new Error('Codec not supported'))).toBe('generic');
    });

    it('null → generic (defensive)', () => {
      expect(classifyPlaybackError(null)).toBe('generic');
    });

    it('undefined → generic (defensive)', () => {
      expect(classifyPlaybackError(undefined)).toBe('generic');
    });
  });
});
