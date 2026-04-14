import { useState, useEffect, useCallback } from 'react';
import { PLAYER_STATES, ERRORS } from './constants';
import api from '../../utils/api';

/**
 * High-level player controls: playPause, skip, restart, authorize, changeMode.
 *
 * These are the public actions exposed to the UI. They compose lower-level
 * engine primitives (playSong, beginTransition, endTransition).
 *
 * Owns: autoplayMode.
 * Reads from refs: music, playerState, currentSongId, playLock, queue, hasUserGesture.
 * Writes to refs: hasUserGesture, currentSongId, autoplayMode.
 * Calls via refs: playSong, fetchQueue.
 */
export function usePlayerControls(refs, venueCode, {
  playSong,
  beginTransition,
  endTransition,
  updatePlayerState,
  setErrorWithPriority,
  setIsAuthorized,
  setQueue,
  fetchQueue,
}) {
  const [autoplayMode, setAutoplayMode] = useState('playlist');

  // Keep ref in sync
  useEffect(() => { refs.autoplayMode = autoplayMode; }, [refs, autoplayMode]);

  // ── playPause ────────────────────────────────────────────────────────────
  // No beginTransition() here — setPlayerState('transitioning') would trigger a
  // React re-render that breaks WebKit's user gesture chain before music.play().
  const playPause = useCallback(async () => {
    const music = refs.music;
    if (!music) return;
    refs.hasUserGesture = true;
    const wasWaiting = refs.playerState === PLAYER_STATES.WAITING;
    const nowPlaying = refs.queue.nowPlaying;
    const mk = music.playbackState;

    if (mk === 2) {
      await music.pause();
      if (nowPlaying) api.pausePlaying(venueCode, nowPlaying.id).catch(() => {});
    } else if (wasWaiting && nowPlaying) {
      refs.currentSongId = nowPlaying.id;
      await playSong(nowPlaying);
    } else if (mk === 3) {
      if (nowPlaying && nowPlaying.id !== refs.currentSongId) {
        refs.currentSongId = nowPlaying.id;
        await playSong(nowPlaying);
      } else {
        try {
          await music.play();
          if (nowPlaying) {
            api.reportPlaying(venueCode, nowPlaying.id, music.currentPlaybackTime || 0).catch(() => {});
          }
        } catch (err) {
          if (
            err?.name === 'NotAllowedError' ||
            err?.name === 'AbortError' ||
            err?.message?.toLowerCase().includes('interact') ||
            err?.message?.toLowerCase().includes('abort')
          ) {
            updatePlayerState(PLAYER_STATES.WAITING);
          } else {
            console.error('Play error:', err);
          }
        }
      }
    } else if (mk === 0 || mk === 4 || mk === 5) {
      if (nowPlaying) {
        refs.currentSongId = nowPlaying.id;
        await playSong(nowPlaying);
      }
    }
  }, [refs, venueCode, playSong, updatePlayerState]);

  // ── skip ─────────────────────────────────────────────────────────────────
  const skip = useCallback(async () => {
    if (refs.playerState === PLAYER_STATES.TRANSITIONING) return;
    if (refs.playLock) return;
    // DO NOT call music.stop() here — setQueue({ startPlaying: true }) in
    // playSong replaces the queue atomically.  Calling stop() first tears down
    // the iOS audio session and causes "Operation was aborted".
    beginTransition();
    const currentQueue = refs.queue;
    const skippedSongId = currentQueue.nowPlaying?.id;

    const optimisticNext = currentQueue.upcoming[0];
    if (optimisticNext) {
      const nextNow = { ...optimisticNext, positionMs: 0, positionAnchoredAt: Date.now(), isPaused: false };
      setQueue({ nowPlaying: nextNow, upcoming: currentQueue.upcoming.slice(1) });
      refs.currentSongId = optimisticNext.id;
    } else {
      refs.currentSongId = null;
    }

    await Promise.allSettled([
      api.skipSong(venueCode, skippedSongId).catch((err) => console.error('Skip error:', err)),
      optimisticNext ? playSong(optimisticNext) : Promise.resolve(),
    ]);
    endTransition();

    fetchQueue().catch(() => {});
  }, [refs, venueCode, playSong, beginTransition, endTransition, setQueue, fetchQueue]);

  // ── restart ──────────────────────────────────────────────────────────────
  const restart = useCallback(async () => {
    const music = refs.music;
    const np = refs.queue.nowPlaying;
    if (!music || !np) return;
    try { await music.seekToTime(0); } catch {}
    api.reportPlaying(venueCode, np.id, 0).catch(() => {});
  }, [refs, venueCode]);

  // ── authorize ────────────────────────────────────────────────────────────
  const authorize = useCallback(async () => {
    const music = refs.music;
    if (!music) return;
    refs.hasUserGesture = true;
    try {
      await music.authorize();
      setIsAuthorized(music.isAuthorized);
    } catch (err) {
      console.error('Auth error:', err);
      if (!music.isAuthorized) {
        setErrorWithPriority(ERRORS.APPLE_CONNECT);
      } else {
        setIsAuthorized(true);
      }
    }
  }, [refs, setIsAuthorized, setErrorWithPriority]);

  // ── changeMode ───────────────────────────────────────────────────────────
  const changeMode = useCallback(async (mode) => {
    setAutoplayMode(mode);
    refs.autoplayMode = mode;
    await api.updateSettings(venueCode, {
      autoplayQueue: mode !== 'off',
      autoplayMode: mode,
    }).catch(console.error);
  }, [refs, venueCode]);

  const initAutoplayMode = useCallback((mode) => {
    setAutoplayMode(mode);
    refs.autoplayMode = mode;
  }, [refs]);

  return { autoplayMode, playPause, skip, restart, authorize, changeMode, initAutoplayMode };
}
