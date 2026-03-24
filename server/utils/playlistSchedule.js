/**
 * Dayparting: match venue.settings.playlistSchedule slots to "now".
 * Slot shape: { playlistId, startHour, endHour, startMinute?, endMinute?, days? }
 * days: JS weekday numbers 0=Sun … 6=Sat. Omitted or empty = all days.
 * Time range is [start, end) in minutes from midnight; supports overnight (e.g. 22:00–02:00).
 */

function minutesFromMidnight(date) {
  return date.getHours() * 60 + date.getMinutes();
}

function slotEndExclusiveMinutes(s) {
  const eh = s.endHour ?? 0;
  const em = s.endMinute ?? 0;
  return eh * 60 + em;
}

function slotStartMinutes(s) {
  const sh = s.startHour ?? 0;
  const sm = s.startMinute ?? 0;
  return sh * 60 + sm;
}

function slotMatches(s, now = new Date()) {
  if (!s || typeof s.startHour !== 'number' || typeof s.endHour !== 'number') return false;
  const currentDay = now.getDay();
  if (Array.isArray(s.days) && s.days.length > 0 && !s.days.includes(currentDay)) {
    return false;
  }
  const cur = minutesFromMidnight(now);
  const start = slotStartMinutes(s);
  const end = slotEndExclusiveMinutes(s);
  if (start <= end) {
    return cur >= start && cur < end;
  }
  return cur >= start || cur < end;
}

/**
 * @param {object[]} schedule
 * @param {object[]} playlists venue.playlists
 * @param {Date} [now]
 * @returns {object|null} playlist object with .songs or null
 */
function findScheduledPlaylist(schedule, playlists, now = new Date()) {
  if (!Array.isArray(schedule) || schedule.length === 0 || !Array.isArray(playlists)) return null;
  for (const s of schedule) {
    if (!slotMatches(s, now)) continue;
    const pl = playlists.find((p) => p.id === s.playlistId);
    if (pl && Array.isArray(pl.songs) && pl.songs.length > 0) return pl;
  }
  return null;
}

module.exports = { slotMatches, findScheduledPlaylist, minutesFromMidnight };
