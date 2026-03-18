/**
 * logEvent — structured server-side logging helper.
 *
 * Produces lines like:
 *   [venueCode=ABC123] [action=advance] [songId=song_xyz] Queue advanced to next song
 *
 * Use the greppable fields to trace a single venue's session across logs:
 *   grep "venueCode=ABC123" server.log
 *
 * @param {object} params
 * @param {string}  params.venueCode
 * @param {string}  params.action      - camelCase verb (advance, skip, autofill, …)
 * @param {string}  [params.songId]
 * @param {string}  [params.detail]    - free-text message
 * @param {'info'|'warn'|'error'} [params.level='info']
 */
function logEvent({ venueCode, action, songId, detail, level = 'info' }) {
  const parts = [`[venueCode=${venueCode || '?'}]`];
  if (action) parts.push(`[action=${action}]`);
  if (songId) parts.push(`[songId=${songId}]`);
  if (detail) parts.push(detail);
  const msg = parts.join(' ');
  if (level === 'error') console.error(msg);
  else if (level === 'warn') console.warn(msg);
  else console.log(msg);
}

module.exports = { logEvent };
