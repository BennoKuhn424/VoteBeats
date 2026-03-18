/**
 * validateQueue — run before every db.updateQueue() call.
 *
 * Checks core invariants and fixes simple ones in-place, then logs a warning
 * with a greppable [QUEUE_INVARIANT] prefix so you get an early signal when
 * the queue shape drifts in unexpected ways as the code evolves.
 *
 * Returns { valid: boolean, issues: string[] }.
 * Callers should still write the queue even when issues are found — the
 * auto-fixes make the resulting state safe to persist.
 */
function validateQueue(venueCode, queue) {
  const issues = [];

  if (!queue || typeof queue !== 'object') {
    issues.push('queue is null or not an object');
    console.warn(`[QUEUE_INVARIANT] venueCode=${venueCode}`, issues);
    return { valid: false, issues };
  }

  const upcoming = queue.upcoming || [];

  // ── Unique IDs in upcoming ────────────────────────────────────────────────
  const seenIds = new Set();
  const beforeLen = upcoming.length;
  queue.upcoming = upcoming.filter((s) => {
    if (!s.id || seenIds.has(s.id)) {
      issues.push(`duplicate or missing id in upcoming: ${s.id ?? '(none)'}`);
      return false;
    }
    seenIds.add(s.id);
    return true;
  });
  if (queue.upcoming.length !== beforeLen) {
    issues.push(`removed ${beforeLen - queue.upcoming.length} duplicate(s) from upcoming`);
  }

  // ── nowPlaying must not also be in upcoming ───────────────────────────────
  if (queue.nowPlaying?.id) {
    const nowId = queue.nowPlaying.id;
    const dupIdx = queue.upcoming.findIndex((s) => s.id === nowId);
    if (dupIdx !== -1) {
      issues.push(`nowPlaying id=${nowId} was also in upcoming — removed from upcoming`);
      queue.upcoming.splice(dupIdx, 1);
    }
  }

  // ── Reasonable duration (must be a positive number ≤ 1 hour) ─────────────
  const dur = queue.nowPlaying?.duration;
  if (dur !== undefined && dur !== null) {
    if (typeof dur !== 'number' || dur < 0 || dur > 3600) {
      issues.push(`nowPlaying.duration=${dur} is out of range [0, 3600]`);
    }
  }

  // ── Upcoming song items have required fields ──────────────────────────────
  queue.upcoming.forEach((s, i) => {
    if (!s.appleId) issues.push(`upcoming[${i}] (id=${s.id}) is missing appleId`);
  });

  if (issues.length > 0) {
    console.warn(`[QUEUE_INVARIANT] venueCode=${venueCode} —`, issues.join('; '));
  }

  return { valid: issues.length === 0, issues };
}

module.exports = { validateQueue };
