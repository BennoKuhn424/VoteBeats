/**
 * Dayparting: match venue.settings.playlistSchedule slots to "now".
 * Slot shape: { playlistId, startHour, endHour, startMinute?, endMinute?, days? }
 * days: JS weekday numbers 0=Sun … 6=Sat. Omitted or empty = all days.
 * Time range is [start, end) in minutes from midnight; supports overnight (e.g. 22:00–02:00).
 *
 * Timezone: schedule slots are interpreted in the venue's local timezone
 * (venue.settings.timezone, IANA name like 'Africa/Johannesburg'). The server
 * itself runs in UTC on Render, so without this conversion a "2:00 PM" slot
 * would fire at 2:00 PM UTC = 4:00 PM SAST. Defaults to Africa/Johannesburg
 * when the venue hasn't set one — Speeldit is a South Africa product.
 */

const DEFAULT_VENUE_TIMEZONE = 'Africa/Johannesburg';

/**
 * Resolve venue timezone with safe fallback. Returns the default if the
 * supplied value is missing, non-string, or not a valid IANA zone.
 * @param {string|undefined|null} tz
 * @returns {string}
 */
function resolveTimezone(tz) {
  if (typeof tz !== 'string' || !tz) return DEFAULT_VENUE_TIMEZONE;
  try {
    // Throws RangeError on invalid IANA name; cheap validation.
    new Intl.DateTimeFormat('en-GB', { timeZone: tz });
    return tz;
  } catch {
    return DEFAULT_VENUE_TIMEZONE;
  }
}

/**
 * Read the hour, minute, and JS weekday of `date` as observed in `timeZone`.
 * Using Intl.DateTimeFormat keeps us correct across DST without bringing in
 * a 200KB tz library — Node has the ICU data baked in since v13.
 * @param {Date} date
 * @param {string} timeZone IANA name
 * @returns {{ hour: number, minute: number, day: number }} day is 0=Sun … 6=Sat
 */
function readLocalTime(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: 'numeric',
    minute: 'numeric',
    weekday: 'short',
    hour12: false,
  }).formatToParts(date);

  const get = (type) => parts.find((p) => p.type === type)?.value;
  const hour = parseInt(get('hour'), 10) || 0;
  const minute = parseInt(get('minute'), 10) || 0;
  const weekdayMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const day = weekdayMap[get('weekday')] ?? date.getDay();
  return { hour, minute, day };
}

/**
 * Convert a Date to minutes elapsed since midnight, interpreted in the given
 * timezone. Falls back to server-local time when no timezone is given (kept
 * for backward compatibility — existing tests pass a Date and expect local).
 * @param {Date} date
 * @param {string} [timeZone] IANA name; omit for server-local
 * @returns {number} 0–1439
 */
function minutesFromMidnight(date, timeZone) {
  if (timeZone) {
    const { hour, minute } = readLocalTime(date, timeZone);
    return hour * 60 + minute;
  }
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
 *
 * Timezone behaviour:
 *   • If `timeZone` is provided, slot times are interpreted in that IANA
 *     zone (e.g. 'Africa/Johannesburg'). This is what production callers
 *     pass — the server runs in UTC on Render so without this conversion
 *     a "2:00 PM" slot would fire at 4:00 PM SAST.
 *   • If omitted, falls back to server-local time. This is for tests and
 *     anywhere else that constructs Date objects in the test runner's
 *     local timezone.
 *
 * @param {{ startHour: number, endHour: number, startMinute?: number, endMinute?: number, days?: number[] }} s
 * @param {Date} [now]
 * @param {string} [timeZone] IANA timezone for interpretation; omit for server-local
 * @returns {boolean}
 */
function slotMatches(s, now = new Date(), timeZone) {
  if (!s || typeof s.startHour !== 'number' || typeof s.endHour !== 'number') return false;
  let cur;
  let slotStartDay;
  if (timeZone) {
    const local = readLocalTime(now, resolveTimezone(timeZone));
    cur = local.hour * 60 + local.minute;
    slotStartDay = local.day;
  } else {
    cur = now.getHours() * 60 + now.getMinutes();
    slotStartDay = now.getDay();
  }
  const start = slotStartMinutes(s);
  const end = slotEndExclusiveMinutes(s);

  let matchesTime;
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
 * @param {string} [timeZone] IANA timezone, e.g. 'Africa/Johannesburg'
 * @returns {object|null} playlist object with .songs or null
 */
function findScheduledPlaylist(schedule, playlists, now = new Date(), timeZone) {
  if (!Array.isArray(schedule) || schedule.length === 0 || !Array.isArray(playlists)) return null;
  for (const s of schedule) {
    if (!slotMatches(s, now, timeZone)) continue;
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
  resolveTimezone,
  DEFAULT_VENUE_TIMEZONE,
};
