import { useState, useEffect, useCallback } from 'react';
import { PLAYER_STATES, ERRORS } from './constants';
import api from '../../utils/api';

/**
 * MusicKit initialization, event listeners, and auth state tracking.
 *
 * Owns: isAuthorized, playbackTime, playbackDuration, initKey/retryInit.
 * Writes to refs: music.
 * Reads from refs: playerState, currentSongId, autoplayMode, playLock, queue.
 * Calls via refs: playSong, fetchQueue.
 */
export function useMusicKitInit(refs, venueCode, { updatePlayerState, setPlayerError, setErrorWithPriority, setQueue }) {
  const [isAuthorized, setIsAuthorized] = useState(false);
  const [playbackTime, setPlaybackTime] = useState(0);
  const [playbackDuration, setPlaybackDuration] = useState(0);
  const [initKey, setInitKey] = useState(0);

  useEffect(() => {
    if (!venueCode) return;
    if (!localStorage.getItem('speeldit_logged_in')) return;

    let stateListener = null;
    let timeListener = null;
    let itemListener = null;
    let authListener = null;
    let errorListener = null;
    let onVisibilityForAuth = null;

    async function init() {
      try {
        let music;
        try { music = MusicKit.getInstance(); } catch {}
        if (!music) {
          const res = await api.getDeveloperToken();
          const devToken = res.data?.token || res.data?.developerToken;
          if (!devToken) {
            setPlayerError(ERRORS.APPLE_CONNECT);
            return;
          }
          await MusicKit.configure({
            developerToken: devToken,
            app: { name: 'Speeldit', build: '1.0' },
          });
          music = MusicKit.getInstance();
        }
        refs.music = music;
        setIsAuthorized(music.isAuthorized);
        setPlayerError(null);

        if (typeof navigator !== 'undefined' && navigator.audioSession?.type !== undefined) {
          try { navigator.audioSession.type = 'playback'; } catch (_) {}
        }

        const initialState =
          music.playbackState === 2 ? PLAYER_STATES.PLAYING :
          music.playbackState === 3 ? PLAYER_STATES.PAUSED :
          PLAYER_STATES.IDLE;
        updatePlayerState(initialState);

        setPlaybackTime(music.currentPlaybackTime || 0);
        setPlaybackDuration(music.currentPlaybackDuration || 0);

        // MusicKit state listener — drives playerState when not transitioning.
        stateListener = () => {
          if (refs.playerState === PLAYER_STATES.TRANSITIONING) return;
          if (refs.playerState === PLAYER_STATES.WAITING &&
              music.playbackState !== 2 && music.playbackState !== 3) return;

          const mk = music.playbackState;
          if (mk === 2) updatePlayerState(PLAYER_STATES.PLAYING);
          else if (mk === 3) updatePlayerState(PLAYER_STATES.PAUSED);
          else if (mk === 0 || mk === 4 || mk === 5) {
            updatePlayerState(PLAYER_STATES.IDLE);
            if (mk === 5 && refs.autoplayMode !== 'off') {
              const endedId = refs.currentSongId;
              refs.currentSongId = null;

              music.skipToNextItem().catch(() => {});

              if (endedId) {
                api.advanceQueue(venueCode, endedId)
                  .catch(() => {})
                  .finally(() => {
                    setTimeout(() => {
                      if (!refs.currentSongId && !refs.playLock) {
                        refs.fetchQueue?.();
                      }
                    }, 2000);
                  });
              }
            }
          }
        };

        timeListener = () => {
          setPlaybackTime(music.currentPlaybackTime || 0);
          setPlaybackDuration(music.currentPlaybackDuration || 0);
        };

        // Detect background auto-advance via MusicKit's pre-loaded queue.
        itemListener = () => {
          if (refs.playLock) return;
          const newAppleId = String(music.nowPlayingItem?.id || '');
          if (!newAppleId) return;
          const upcoming = refs.queue?.upcoming ?? [];
          const idx = upcoming.findIndex((s) => String(s?.appleId) === newAppleId);
          if (idx < 0 || refs.currentSongId === upcoming[idx]?.id) return;
          const nextSong = upcoming[idx];
          const endedSongId = refs.currentSongId;
          refs.currentSongId = nextSong.id;
          setQueue((prev) => ({
            nowPlaying: { ...nextSong, positionMs: 0, positionAnchoredAt: Date.now(), isPaused: false },
            upcoming: [...(prev.upcoming || []).slice(0, idx), ...(prev.upcoming || []).slice(idx + 1)],
          }));
          api.advanceQueue(venueCode, endedSongId).catch((e) =>
            console.warn('[BG_ADVANCE] server sync failed:', e?.message));
        };

        authListener = () => { setIsAuthorized(music.isAuthorized); };
        music.addEventListener('authorizationStatusDidChange', authListener);

        // DRM / media key error handler — catches EME key session failures
        // that fire asynchronously after setQueue/play() resolve (e.g. Safari
        // iPhone "MEDIA_Key error in dispatchkeyerror: TypeError{}").
        errorListener = (evt) => {
          const err = evt?.error || evt;
          const reason = String(err?.reason || '').toUpperCase();
          const msg = String(err?.message || err?.errorCode || err?.description || '').toLowerCase();
          console.error('[MUSICKIT_MEDIA_ERROR]', err);

          // iOS Safari: MEDIA_SESSION means the audio session couldn't activate
          // (usually the user-gesture chain was broken across an await).
          // Don't unauthorize — just park in WAITING so the next tap retries
          // play within a fresh gesture context.
          const isMediaSession = reason === 'MEDIA_SESSION' || msg.includes('media_session');
          if (isMediaSession) {
            updatePlayerState(PLAYER_STATES.WAITING);
            return;
          }

          const isDrmKey = reason.includes('KEY') || reason.includes('DRM') ||
            msg.includes('key') || msg.includes('drm') ||
            msg.includes('media_key') || msg.includes('decrypt') ||
            msg.includes('license') || err?.name === 'TypeError';

          if (isDrmKey) {
            // Stale Music User Token — invalidate so Retry triggers fresh auth
            music.unauthorize().catch(() => {});
            setIsAuthorized(false);
            updatePlayerState(PLAYER_STATES.IDLE);
            setErrorWithPriority(ERRORS.DRM_KEY);
          } else {
            setErrorWithPriority(ERRORS.PLAYBACK_FAILED);
          }
        };
        music.addEventListener('mediaPlaybackError', errorListener);

        onVisibilityForAuth = () => {
          if (!document.hidden) setIsAuthorized(music.isAuthorized);
        };
        document.addEventListener('visibilitychange', onVisibilityForAuth);

        music.addEventListener('playbackStateDidChange', stateListener);
        music.addEventListener('playbackTimeDidChange', timeListener);
        music.addEventListener('nowPlayingItemDidChange', itemListener);
      } catch (err) {
        console.error('[APPLE_INIT_FAIL] MusicKit init error:', err);
        const isNetwork = !navigator.onLine || err?.message?.includes('not defined') || err?.name === 'TypeError';
        setPlayerError(isNetwork ? ERRORS.NO_INTERNET : ERRORS.APPLE_CONNECT);
      }
    }
    init();

    return () => {
      const music = refs.music;
      if (music) {
        if (stateListener) music.removeEventListener('playbackStateDidChange', stateListener);
        if (timeListener) music.removeEventListener('playbackTimeDidChange', timeListener);
        if (itemListener) music.removeEventListener('nowPlayingItemDidChange', itemListener);
        if (authListener) music.removeEventListener('authorizationStatusDidChange', authListener);
        if (errorListener) music.removeEventListener('mediaPlaybackError', errorListener);
      }
      if (onVisibilityForAuth) document.removeEventListener('visibilitychange', onVisibilityForAuth);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [venueCode, initKey]);

  const retryInit = useCallback(async () => {
    setPlayerError(null);
    // If MusicKit exists but authorization was invalidated (DRM key error),
    // re-authorize within this tap's gesture context before re-initializing.
    const music = refs.music;
    if (music && !music.isAuthorized) {
      try {
        await music.authorize();
        setIsAuthorized(music.isAuthorized);
        // Replay the current song if one was queued
        if (music.isAuthorized) {
          updatePlayerState(PLAYER_STATES.IDLE);
          const np = refs.queue?.nowPlaying;
          if (np && refs.playSong) {
            refs.currentSongId = np.id;
            refs.playSong(np);
          }
          return;
        }
      } catch (err) {
        console.warn('[RETRY_AUTH] re-authorize failed:', err?.message);
      }
    }
    setInitKey((k) => k + 1);
  }, [refs, setPlayerError, setIsAuthorized, updatePlayerState]);

  return { isAuthorized, setIsAuthorized, playbackTime, playbackDuration, retryInit };
}
