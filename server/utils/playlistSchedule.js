/**
 * Dayparting: match venue.settings.playlistSchedule slots to "now".
 * Slot shape: { playlistId, startHour, endHour, startMinute?, endMinute?, days? }
 * days: JS weekday numbers 0=Sun … 6=Sat. Omitted or empty = all days.
 * Time range is [start, end) in minutes from midnight; supports overnight (e.g. 22:00–02:00).
 */

/**
 * Convert a Date to minutes elapsed since midnight (in the Date's local timezone).
 * @param {Date} date
 * @returns {number} 0–1439
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

function previousDay(day) {
  return (day + 6) % 7;
}

function slotDays(s) {
  if (Array.isArray(s.days) && s.days.length > 0) {
    return [...new Set(s.days.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))];
  }
  return [0, 1, 2, 3, 4, 5, 6];
}

function slotWeeklyIntervals(s) {
  const start = slotStartMinutes(s);
  const end = slotEndExclusiveMinutes(s);
  if (start === end) return [];

  const intervals = [];
  for (const day of slotDays(s)) {
    const dayStart = day * 1440;
    if (start < end) {
      intervals.push({ start: dayStart + start, end: dayStart + end });
    } else {
      intervals.push({ start: dayStart + start, end: dayStart + 1440 });
      const nextDayStart = ((day + 1) % 7) * 1440;
      intervals.push({ start: nextDayStart, end: nextDayStart + end });
    }
  }
  return intervals;
}

function intervalsOverlap(a, b) {
  return a.start < b.end && b.start < a.end;
}

function findScheduleOverlap(schedule) {
  if (!Array.isArray(schedule)) return null;
  const seen = [];
  for (let i = 0; i < schedule.length; i++) {
    for (const interval of slotWeeklyIntervals(schedule[i])) {
      for (const prior of seen) {
        if (intervalsOverlap(interval, prior.interval)) {
          return {
            firstIndex: prior.index,
            secondIndex: i,
            first: schedule[prior.index],
            second: schedule[i],
          };
        }
      }
      seen.push({ index: i, interval });
    }
  }
  return null;
}

/**
 * Check whether a schedule slot is active at a given time.
 * Supports overnight ranges (e.g. startHour=22, endHour=2).
 * @param {{ startHour: number, endHour: number, startMinute?: number, endMinute?: number, days?: number[] }} s
 * @param {Date} [now]
 * @returns {boolean}
 */
function slotMatches(s, now = new Date()) {
  if (!s || typeof s.startHour !== 'number' || typeof s.endHour !== 'number') return false;
  const cur = minutesFromMidnight(now);
  const start = slotStartMinutes(s);
  const end = slotEndExclusiveMinutes(s);

  let matchesTime;
  let slotStartDay = now.getDay();
  if (start <= end) {
    matchesTime = cur >= start && cur < end;
  } else {
    matchesTime = cur >= start || cur < end;
    if (cur < end) {
      // For overnight ranges, 01:00 Thursday belongs to Wednesday's 22:00 slot.
      slotStartDay = previousDay(slotStartDay);
    }
  }

  if (!matchesTime) return false;

  if (Array.isArray(s.days) && s.days.length > 0 && !s.days.includes(slotStartDay)) {
    return false;
  }
  return true;
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

module.exports = {
  slotMatches,
  findScheduledPlaylist,
  findScheduleOverlap,
  minutesFromMidnight,
};
