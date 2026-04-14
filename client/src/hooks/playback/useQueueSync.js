import { useState, useEffect, useCallback } from 'react';
import { PLAYER_STATES } from './constants';
import { isValidQueuePayload } from '../../utils/socketValidation';
import { useVisibilityAwarePolling } from '../useVisibilityAwarePolling';
import api from '../../utils/api';
import socket from '../../utils/socket';

/**
 * Queue synchronization: state, socket.io, HTTP fetch, autofill.
 *
 * Owns: queue, autofillNotice, handleQueueUpdate, fetchQueue, tryAutofill.
 * Reads from refs: playerState, currentSongId, playLock, autoplayMode, music,
 *                  autofill404Until, autofillBackoff, autofillDismissedAt.
 * Writes to refs: queue, pendingQueue, currentSongId, handleQueueUpdate, fetchQueue,
 *                 autofill404Until, autofillBackoff, autofillDismissedAt.
 * Calls via refs: playSong.
 */
export function useQueueSync(refs, venueCode, { beginTransition, endTransition, updatePlayerState }) {
  const [queue, setQueue] = useState({ nowPlaying: null, upcoming: [] });
  const [autofillNotice, setAutofillNotice] = useState(false);

  // Keep refs.queue in sync
  useEffect(() => { refs.queue = queue; }, [refs, queue]);

  const dismissAutofillNotice = useCallback(() => {
    refs.autofillDismissedAt = Date.now();
    setAutofillNotice(false);
  }, [refs]);

  // ── tryAutofill ──────────────────────────────────────────────────────────
  const tryAutofill = useCallback(async () => {
    if (refs.autoplayMode === 'off') return false;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return false;
    if (Date.now() < refs.autofill404Until) return false;
    try {
      const res = await api.autofillQueue(venueCode);
      if (res.data?.filled === false) {
        const reason = res.data?.reason || '';
        if (reason === 'Queue is not empty' || reason === 'Queue was filled by another request') {
          refs.autofillBackoff = 5000;
          return false;
        }
        const backoff = refs.autofillBackoff;
        refs.autofill404Until = Date.now() + backoff;
        console.warn(`Autofill: no songs — backing off ${backoff / 1000}s.`);
        refs.autofillBackoff = Math.min(backoff * 2, 30000);
        const NOTICE_COOLDOWN_MS = 5 * 60 * 1000;
        if (Date.now() - refs.autofillDismissedAt > NOTICE_COOLDOWN_MS) {
          setAutofillNotice(true);
        }
        return false;
      }
      refs.autofillBackoff = 5000;
      setAutofillNotice(false);
      return true;
    } catch (err) {
      console.error('Autofill error:', err);
      return false;
    }
  }, [refs, venueCode]);

  // ── handleQueueUpdate ────────────────────────────────────────────────────
  const handleQueueUpdate = useCallback(async (newQueue) => {
    if (!isValidQueuePayload(newQueue)) return;
    setQueue(newQueue);
    const nowPlaying = newQueue.nowPlaying;

    if (refs.playLock) {
      refs.pendingQueue = newQueue;
      return;
    }

    if (nowPlaying && nowPlaying.id !== refs.currentSongId &&
        refs.playerState !== PLAYER_STATES.TRANSITIONING) {
      const currentAppleId = refs.music?.nowPlayingItem?.id;
      if (currentAppleId && String(currentAppleId) === String(nowPlaying.appleId)) {
        refs.currentSongId = nowPlaying.id;
      } else if (refs.music?.playbackState === 3 && refs.currentSongId) {
        // Paused with a song loaded — don't interrupt
      } else if (!refs.hasUserGesture) {
        updatePlayerState(PLAYER_STATES.WAITING);
      } else {
        // iOS transient activation expires ~5s after a tap. Socket-driven
        // playSong from an idle player outside that window fails with MKError
        // "MEDIA_SESSION". If MusicKit is idle/none AND the last gesture is
        // stale, park in WAITING so the next tap retries cleanly.
        const IOS_ACTIVATION_WINDOW_MS = 4000;
        // iOS keeps the media session "active" for ~90s after the last successful
        // play start — during that window setQueue works without a fresh tap,
        // which is what lets autoplay auto-advance to the next song.
        const SESSION_ACTIVE_WINDOW_MS = 90_000;
        const mkState = refs.music?.playbackState ?? 0;
        const isIdle = mkState === 0 || mkState === 4 || mkState === 5;
        const now = Date.now();
        const gestureFresh = now - (refs.lastGestureAt || 0) <= IOS_ACTIVATION_WINDOW_MS;
        const sessionActive = now - (refs.lastPlayStartedAt || 0) <= SESSION_ACTIVE_WINDOW_MS;
        if (isIdle && !gestureFresh && !sessionActive) {
          updatePlayerState(PLAYER_STATES.WAITING);
        } else {
          beginTransition();
          refs.currentSongId = nowPlaying.id;
          try { await refs.playSong?.(nowPlaying); } finally { endTransition(); }
        }
      }
    }

    if (!nowPlaying && refs.autoplayMode !== 'off' &&
        refs.playerState !== PLAYER_STATES.TRANSITIONING &&
        !refs.playLock) {
      const filled = await tryAutofill();
      if (filled) {
        try {
          const r = await api.getQueue(venueCode);
          const np = r.data?.nowPlaying;
          setQueue(r.data);
          if (np?.appleId && np.id !== refs.currentSongId &&
              refs.playerState !== PLAYER_STATES.TRANSITIONING &&
              !refs.playLock) {
            const IOS_ACTIVATION_WINDOW_MS = 4000;
            const mkState = refs.music?.playbackState ?? 0;
            const isIdle = mkState === 0 || mkState === 4 || mkState === 5;
            const gestureStale = Date.now() - (refs.lastGestureAt || 0) > IOS_ACTIVATION_WINDOW_MS;
            if (isIdle && gestureStale) {
              updatePlayerState(PLAYER_STATES.WAITING);
            } else {
              beginTransition();
              refs.currentSongId = np.id;
              try { await refs.playSong?.(np); } finally { endTransition(); }
            }
          }
        } catch {}
      }
    }
  }, [refs, venueCode, tryAutofill, beginTransition, endTransition, updatePlayerState]);

  // Register in refs
  refs.handleQueueUpdate = handleQueueUpdate;

  // ── fetchQueue ───────────────────────────────────────────────────────────
  const fetchQueue = useCallback(async () => {
    if (!venueCode) return;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
    try {
      const res = await api.getQueue(venueCode, undefined, { timeout: 5000, 'axios-retry': { retries: 1 } });
      await handleQueueUpdate(res.data);
    } catch (err) {
      console.warn('Queue fetch failed:', err?.message);
    }
  }, [venueCode, handleQueueUpdate]);

  refs.fetchQueue = fetchQueue;

  // ── Socket.IO ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!venueCode) return;

    function joinRoom() { socket.emit('join', venueCode); }
    socket.connect();
    joinRoom();

    function onConnect() {
      joinRoom();
      setTimeout(fetchQueue, 300);
    }
    socket.on('connect', onConnect);
    socket.on('queue:updated', handleQueueUpdate);
    fetchQueue();

    return () => {
      socket.off('connect', onConnect);
      socket.off('queue:updated', handleQueueUpdate);
      socket.disconnect();
    };
  }, [venueCode, fetchQueue, handleQueueUpdate]);

  // ── Visibility-aware fallback poll ───────────────────────────────────────
  useVisibilityAwarePolling(fetchQueue, 15000);

  // ── Auto-clear autofill notice when a song starts ────────────────────────
  useEffect(() => {
    if (queue.nowPlaying) setAutofillNotice(false);
  }, [queue.nowPlaying]);

  return {
    queue,
    setQueue,
    fetchQueue,
    autofillNotice,
    dismissAutofillNotice,
  };
}
