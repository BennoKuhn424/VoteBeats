import { useState, useCallback } from 'react';
import { PLAYER_STATES, ERROR_PRIORITY, ERRORS } from './constants';
import {
  withTimeout,
  buildPreloadAppleIds,
  runSetQueueThenPlay,
  TRANSITION_WATCHDOG_MS,
  PLAY_LOCK_SAFETY_MS,
  STOP_TIMEOUT_MS,
  POST_STOP_DELAY_MS,
} from '../../utils/venuePlaybackPlay';
import api from '../../utils/api';

/**
 * Core playback engine: state machine, transitions, playSong with locking.
 *
 * Owns: playerState, playbackLoading, playerError, beginTransition/endTransition, playSong.
 * Reads from refs: music, currentSongId, playerState, playLock, queue, pendingQueue.
 * Writes to refs: playerState, currentSongId, playLock, pendingQueue, playFailCount, playSong.
 */
export function usePlaybackEngine(refs, venueCode) {
  const [playerState, setPlayerState] = useState(PLAYER_STATES.NOT_READY);
  const [playbackLoading, setPlaybackLoading] = useState(false);
  const [playerError, setPlayerError] = useState(null);

  // ── setPlayerState wrapper: keeps ref in sync ─────────────────────────────
  const updatePlayerState = useCallback((next) => {
    refs.playerState = next;
    setPlayerState(next);
  }, [refs]);

  // ── Error priority ───────────────────────────────────────────────────────
  const setErrorWithPriority = useCallback((newMsg) => {
    setPlayerError((prev) => {
      if (!newMsg) return null;
      const newP = ERROR_PRIORITY[newMsg] ?? 99;
      const prevP = ERROR_PRIORITY[prev] ?? 99;
      return newP <= prevP ? newMsg : prev;
    });
  }, []);

  const clearError = useCallback(() => {
    refs.hcLastFired = {};
    setPlayerError(null);
  }, [refs]);

  // ── Transition helpers ───────────────────────────────────────────────────
  const beginTransition = useCallback(() => {
    updatePlayerState(PLAYER_STATES.TRANSITIONING);
    clearTimeout(refs.transitionWatchdog);
    refs.transitionWatchdog = setTimeout(() => {
      if (refs.playerState === PLAYER_STATES.TRANSITIONING) {
        console.warn(`[PLAYER_WATCHDOG] transition stuck >${TRANSITION_WATCHDOG_MS / 1000}s — forcing reset`);
        updatePlayerState(PLAYER_STATES.IDLE);
        setErrorWithPriority(ERRORS.GENERIC_RETRY);
      }
    }, TRANSITION_WATCHDOG_MS);
  }, [refs, updatePlayerState, setErrorWithPriority]);

  const endTransition = useCallback(() => {
    clearTimeout(refs.transitionWatchdog);
    const music = refs.music;
    const mk = music?.playbackState;
    const resolved =
      mk === 2 ? PLAYER_STATES.PLAYING :
      mk === 3 ? PLAYER_STATES.PAUSED :
      PLAYER_STATES.IDLE;
    updatePlayerState(resolved);
  }, [refs, updatePlayerState]);

  // ── playSong ─────────────────────────────────────────────────────────────
  const playSong = useCallback(async (song) => {
    const music = refs.music;
    if (!music || !song?.appleId) return;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
    if (refs.playLock) return;
    refs.playLock = true;
    setPlaybackLoading(true);

    const lockSafety = setTimeout(() => {
      if (refs.playLock) {
        console.warn(`[PLAY_LOCK_TIMEOUT] forcing lock release after ${PLAY_LOCK_SAFETY_MS / 1000}s`);
        refs.playLock = false;
        setPlaybackLoading(false);
      }
    }, PLAY_LOCK_SAFETY_MS);

    try {
      if (!music.isAuthorized) {
        await music.authorize();
      }
      const mk = music.playbackState;
      if (mk === 1 || mk === 2 || mk === 3) {
        try { await withTimeout(music.stop(), STOP_TIMEOUT_MS); } catch {}
        // Only delay when we actually stopped — keeps the gap minimal so the
        // user-gesture context survives on mobile Safari.
        await new Promise((r) => setTimeout(r, POST_STOP_DELAY_MS));
      }

      const ids = buildPreloadAppleIds(song, refs.queue?.upcoming ?? []);
      await runSetQueueThenPlay(music, ids);
      setPlayerError(null);
      refs.playFailCount = 0;
      api.reportPlaying(venueCode, song.id, 0).catch(() => {});
    } catch (err) {
      if (
        err?.name === 'NotAllowedError' ||
        err?.name === 'AbortError' ||
        err?.message?.toLowerCase().includes('interact') ||
        err?.message?.toLowerCase().includes('abort')
      ) {
        updatePlayerState(PLAYER_STATES.WAITING);
      } else {
        console.error('[PLAY_ERROR]', err?.message || err);
        refs.currentSongId = null;
        const isNetwork = !navigator.onLine || /timeout/i.test(err?.message || '');
        refs.playFailCount += 1;
        if (isNetwork) {
          setErrorWithPriority(ERRORS.SLOW_INTERNET);
          refs.playFailCount = 0;
        } else if (refs.playFailCount >= 3) {
          console.warn('[PLAY_FAIL_ATTN] playSong failed 3+ times');
          setErrorWithPriority(ERRORS.NEEDS_ATTENTION);
          refs.playFailCount = 0;
        } else {
          setErrorWithPriority(ERRORS.PLAYBACK_FAILED);
        }
        if (refs.playerState === PLAYER_STATES.TRANSITIONING) {
          endTransition();
        }
      }
    } finally {
      clearTimeout(lockSafety);
      refs.playLock = false;
      setPlaybackLoading(false);
      const pending = refs.pendingQueue;
      if (pending) {
        refs.pendingQueue = null;
        Promise.resolve().then(() => refs.handleQueueUpdate?.(pending));
      }
    }
  }, [refs, venueCode, endTransition, updatePlayerState, setErrorWithPriority]);

  // Register in refs so other hooks can call it
  refs.playSong = playSong;

  return {
    playerState,
    playbackLoading,
    playerError,
    updatePlayerState,
    setErrorWithPriority,
    clearError,
    beginTransition,
    endTransition,
    playSong,
    setPlayerError,
  };
}
