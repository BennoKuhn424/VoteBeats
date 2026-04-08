/**
 * Runtime validation for inbound Socket.IO payloads.
 * Guards against malformed or hijacked socket messages corrupting app state.
 */

/**
 * Validates a queue:updated payload.
 * Must be a plain object with at least an upcoming array.
 * Returns true if safe to use, false to discard.
 */
export function isValidQueuePayload(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return false;
  if (!Array.isArray(data.upcoming)) return false;
  // nowPlaying must be null/undefined or a plain object with a string id
  if (data.nowPlaying !== null && data.nowPlaying !== undefined) {
    if (typeof data.nowPlaying !== 'object' || Array.isArray(data.nowPlaying)) return false;
    if (data.nowPlaying.id !== undefined && typeof data.nowPlaying.id !== 'string') return false;
  }
  return true;
}

/**
 * Validates a volume:feedback payload.
 * Must have a direction of 'too_loud' or 'too_soft'.
 */
export function isValidVolumeFeedbackPayload(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return false;
  if (data.direction !== 'too_loud' && data.direction !== 'too_soft') return false;
  return true;
}
