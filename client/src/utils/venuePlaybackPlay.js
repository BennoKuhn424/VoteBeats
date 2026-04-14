/**
 * Timed MusicKit sequence for venue playback. Used by VenuePlaybackContext and unit tests.
 * Real latency is dominated by setQueue + play(); we keep timeouts aligned across watchdog/lock.
 */

// Race a promise against a timeout — prevents MusicKit calls from hanging forever
export function withTimeout(promise, ms) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`Timeout after ${ms}ms`)), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

/** MusicKit can be slow on cellular / cold cache. Must stay below watchdog + play-lock safety. */
export const PLAY_SET_QUEUE_MS = 28_000;
export const PLAY_START_MS = 18_000;
export const TRANSITION_WATCHDOG_MS = PLAY_SET_QUEUE_MS + PLAY_START_MS + 8_000;
export const PLAY_LOCK_SAFETY_MS = TRANSITION_WATCHDOG_MS + 2_000;

export const STOP_TIMEOUT_MS = 5_000;
export const POST_STOP_DELAY_MS = 100;

/**
 * Same logic as VenuePlaybackContext playSong — preload current + up to 2 upcoming Apple IDs.
 * @param {{ appleId: string, id: string }} song
 * @param {Array<{ appleId?: string, id?: string }>} [upcoming]
 */
export function buildPreloadAppleIds(song, upcoming = []) {
  if (!song?.appleId) return [];
  const others = upcoming.filter((s) => s.appleId && s.id !== song.id);
  const tail = others.slice(0, 2).map((s) => s.appleId);
  return [song.appleId, ...tail].filter(Boolean);
}

/**
 * Dominant path for "queue ready → audio starts": setQueue then play.
 * @param {object} music — MusicKit instance (or mock)
 * @param {string[]} appleIds
 * @param {{ setQueueMs?: number, playMs?: number }} [timeouts] — defaults to production caps
 */
export async function runSetQueueThenPlay(music, appleIds, timeouts = {}) {
  const sq = timeouts.setQueueMs ?? PLAY_SET_QUEUE_MS;
  const pl = timeouts.playMs ?? PLAY_START_MS;
  // MusicKit v3: startPlaying merges setQueue+play into one call so the
  // user-gesture context survives on mobile Safari / Chrome.  We still
  // call play() as a fallback in case the flag is silently ignored.
  await withTimeout(music.setQueue({ songs: appleIds, startPlaying: true }), sq);
  if (music.playbackState !== 2) {
    await withTimeout(music.play(), pl);
  }
}

/**
 * Full path after optional stop: stop (if playing) → short delay → setQueue → play.
 * Used in tests to approximate "first tap → playback started" without React/MusicKit.
 */
export async function runStopDelaySetQueuePlay(music, { song, upcoming = [] }, timeouts = {}) {
  const mk = music.playbackState;
  if (mk === 1 || mk === 2 || mk === 3) {
    try {
      await withTimeout(music.stop(), timeouts.stopMs ?? STOP_TIMEOUT_MS);
    } catch {
      /* ignore */
    }
  }
  await new Promise((r) => setTimeout(r, timeouts.postStopDelayMs ?? POST_STOP_DELAY_MS));
  const ids = buildPreloadAppleIds(song, upcoming);
  await runSetQueueThenPlay(music, ids, timeouts);
}
