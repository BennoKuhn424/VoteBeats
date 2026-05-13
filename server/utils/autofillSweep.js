/**
 * Periodic sweep that finds empty-queue venues and triggers autofill on
 * each one. Why this exists, and why a separate sweep from the fast tick:
 *
 * The fast tick in server.js iterates `db.getQueues()`, which returns a
 * map keyed by venue codes that currently have rows in the `queues` table.
 * If a venue's queue is fully empty (no nowPlaying, no upcoming) it has
 * NO rows in that table and the fast tick never sees it. Without a separate
 * sweep, a scheduled-playlist slot (e.g. "play X every weekday at 14:00")
 * cannot start on time if the queue happened to be empty when the slot
 * began — the autofill code never runs.
 *
 * Behaviour rules:
 *   • Skip any venue whose code is already in `activeQueueCodes` — the
 *     fast tick is handling that one.
 *   • Skip venues with `autoplayMode === 'off'` or `autoplayQueue === false`
 *     so we don't pester venues that have explicitly opted out.
 *   • Errors on one venue must not abort the whole sweep — wrap each call
 *     in try/catch and log.
 */

async function runAutofillSweep({ db, autofillIfQueueEmpty }) {
  if (typeof autofillIfQueueEmpty !== 'function') return;
  let allVenues;
  let activeQueueCodes;
  try {
    allVenues = db.getAllVenues();
    activeQueueCodes = new Set(Object.keys(db.getQueues()));
  } catch (err) {
    console.error('[autofill-sweep] outer error:', err?.message || err);
    return;
  }

  for (const venueCode of Object.keys(allVenues)) {
    if (activeQueueCodes.has(venueCode)) continue;
    const venue = allVenues[venueCode];
    const s = venue?.settings;
    if (s?.autoplayMode === 'off' || s?.autoplayQueue === false) continue;
    try {
      await autofillIfQueueEmpty(venueCode);
    } catch (err) {
      console.error(`[autofill-sweep] venue ${venueCode}:`, err?.message || err);
    }
  }
}

module.exports = { runAutofillSweep };
