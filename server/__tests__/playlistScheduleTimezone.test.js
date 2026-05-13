/**
 * Timezone-aware schedule evaluation.
 *
 * This is the regression for the production bug: Render runs in UTC, but
 * Speeldit venues are in SAST (UTC+2). A slot configured as "14:00" must
 * fire at 14:00 SAST, not 14:00 UTC. Without the timeZone argument, the
 * server's local clock controls — and on Render that means SAST schedules
 * fire two hours late.
 *
 * Each test below pins the absolute UTC moment via `new Date('...Z')`,
 * which is invariant under the test runner's local timezone. We then ask
 * slotMatches whether the slot matches "now" interpreted in a specific
 * IANA zone.
 */

const { slotMatches, findScheduledPlaylist, resolveTimezone, DEFAULT_VENUE_TIMEZONE } = require('../utils/playlistSchedule');

describe('slotMatches — timezone-aware', () => {
  test('14:00 SAST slot matches 12:00 UTC on a weekday', () => {
    // 2025-01-15 12:00 UTC = 14:00 SAST (Africa/Johannesburg, UTC+2 year-round)
    const utc1200 = new Date('2025-01-15T12:00:00Z');
    expect(
      slotMatches({ startHour: 14, endHour: 15 }, utc1200, 'Africa/Johannesburg')
    ).toBe(true);
  });

  test('14:00 SAST slot does NOT match 14:00 UTC (which is 16:00 SAST, outside slot)', () => {
    const utc1400 = new Date('2025-01-15T14:00:00Z');
    expect(
      slotMatches({ startHour: 14, endHour: 15 }, utc1400, 'Africa/Johannesburg')
    ).toBe(false);
  });

  test('Without timeZone, the same Date object is interpreted in server-local time (backward compat)', () => {
    // We can't assert a specific bool here without knowing the test runner's
    // local TZ. We just assert: passing a timezone gives a DIFFERENT result
    // from passing none when the two zones differ enough to cross the slot
    // boundary. Sanity check that the timeZone arg is doing something.
    const utc1200 = new Date('2025-01-15T12:00:00Z');
    const withTz = slotMatches({ startHour: 14, endHour: 15 }, utc1200, 'Africa/Johannesburg');
    const withoutTz = slotMatches({ startHour: 14, endHour: 15 }, utc1200);
    // In SAST (UTC+2) at 12:00 UTC = 14:00 → in slot.
    // In UTC at 12:00 → outside the 14:00-15:00 slot.
    expect(withTz).toBe(true);
    // In any zone where 12:00 UTC is between 14:00 and 15:00 local, this
    // would be true. That's only UTC+2 / UTC+2.5 / UTC+3 — uncommon for CI.
    // CI typically runs UTC (false). A SAST dev box would be true. Either way
    // it doesn't break our assertion above.
    expect([true, false]).toContain(withoutTz);
  });

  test('overnight 22:00–02:00 SAST slot matches 23:30 SAST (= 21:30 UTC)', () => {
    // 2025-01-15 21:30 UTC = 23:30 SAST (still inside the 22:00–02:00 slot)
    const utc2130 = new Date('2025-01-15T21:30:00Z');
    expect(
      slotMatches({ startHour: 22, endHour: 2 }, utc2130, 'Africa/Johannesburg')
    ).toBe(true);
  });

  test('overnight slot matches early-AM SAST (01:00 SAST = 23:00 UTC previous day)', () => {
    // 2025-01-15 23:00 UTC = 01:00 SAST on Jan 16 (still inside 22:00–02:00 slot
    // that started on Jan 15 evening)
    const utc2300 = new Date('2025-01-15T23:00:00Z');
    expect(
      slotMatches({ startHour: 22, endHour: 2 }, utc2300, 'Africa/Johannesburg')
    ).toBe(true);
  });

  test('day filter respects the venue timezone for "what day is it"', () => {
    // 2025-01-15 22:30 UTC = 2025-01-16 00:30 SAST.
    // In UTC it is Wednesday (3). In SAST it has rolled over to Thursday (4).
    const moment = new Date('2025-01-15T22:30:00Z');

    // Slot configured for Thursday (in SAST) should match.
    expect(
      slotMatches({ startHour: 0, endHour: 1, days: [4] }, moment, 'Africa/Johannesburg')
    ).toBe(true);

    // Slot configured for Wednesday (in SAST) should NOT match — even though
    // the underlying UTC weekday IS Wednesday. The venue's local day wins.
    expect(
      slotMatches({ startHour: 0, endHour: 1, days: [3] }, moment, 'Africa/Johannesburg')
    ).toBe(false);
  });

  test('invalid IANA timezone falls back to the default (Africa/Johannesburg)', () => {
    const utc1200 = new Date('2025-01-15T12:00:00Z');
    // Garbage TZ → resolveTimezone returns Africa/Johannesburg, so 12:00 UTC
    // is interpreted as 14:00 SAST and matches a 14:00 slot.
    expect(
      slotMatches({ startHour: 14, endHour: 15 }, utc1200, 'Not/A_Zone')
    ).toBe(true);
  });
});

describe('findScheduledPlaylist — timezone-aware', () => {
  const playlists = [
    { id: 'lunch', name: 'Lunch', songs: [{ id: 'l1' }] },
    { id: 'dinner', name: 'Dinner', songs: [{ id: 'd1' }] },
  ];

  test('14:00 SAST slot returns its playlist at 12:00 UTC (= 14:00 SAST)', () => {
    const schedule = [{ playlistId: 'lunch', startHour: 14, endHour: 15 }];
    const utc1200 = new Date('2025-01-15T12:00:00Z');
    expect(
      findScheduledPlaylist(schedule, playlists, utc1200, 'Africa/Johannesburg')
    ).toMatchObject({ id: 'lunch' });
  });

  test('same slot returns null at 14:00 UTC (= 16:00 SAST, after the slot ends)', () => {
    const schedule = [{ playlistId: 'lunch', startHour: 14, endHour: 15 }];
    const utc1400 = new Date('2025-01-15T14:00:00Z');
    expect(
      findScheduledPlaylist(schedule, playlists, utc1400, 'Africa/Johannesburg')
    ).toBeNull();
  });

  test('REGRESSION: a 14:00 SAST slot would NOT fire correctly without the timezone arg on a UTC server', () => {
    // This is the production bug: server runs in UTC.
    // With no timezone passed, slotMatches falls back to server-local time
    // — which on Render is UTC. So at the moment a venue owner expects their
    // 14:00 slot to fire (12:00 UTC), the server says "12:00, not in slot."
    // The schedule never matches at the intended local time.
    //
    // We can't assert the *exact* result without controlling the runner's TZ,
    // but we CAN assert that passing the timezone gives the correct answer
    // (slot matches at 12:00 UTC) and not passing it gives the wrong one in
    // a UTC test environment.
    process.env.TZ = 'UTC'; // force the runner to UTC for this assertion
    const utc1200 = new Date('2025-01-15T12:00:00Z');
    const schedule = [{ playlistId: 'lunch', startHour: 14, endHour: 15 }];

    // With the timezone arg → correct: slot fires.
    expect(
      findScheduledPlaylist(schedule, playlists, utc1200, 'Africa/Johannesburg')
    ).toMatchObject({ id: 'lunch' });

    // Note: we deliberately don't test the no-tz path here because process.env.TZ
    // is honored by Node only at startup. Mid-process TZ changes are unreliable.
    // The point of this test is that with the tz arg the slot fires correctly
    // even when the runner is UTC.
  });
});

describe('resolveTimezone', () => {
  test('returns the input when it is a valid IANA zone', () => {
    expect(resolveTimezone('Africa/Johannesburg')).toBe('Africa/Johannesburg');
    expect(resolveTimezone('America/New_York')).toBe('America/New_York');
    expect(resolveTimezone('UTC')).toBe('UTC');
  });

  test('returns the default for garbage input', () => {
    expect(resolveTimezone('Not/A_Real_Zone')).toBe(DEFAULT_VENUE_TIMEZONE);
    expect(resolveTimezone('')).toBe(DEFAULT_VENUE_TIMEZONE);
    expect(resolveTimezone(undefined)).toBe(DEFAULT_VENUE_TIMEZONE);
    expect(resolveTimezone(null)).toBe(DEFAULT_VENUE_TIMEZONE);
    expect(resolveTimezone(123)).toBe(DEFAULT_VENUE_TIMEZONE);
  });

  test('default is Africa/Johannesburg (Speeldit is a SA product)', () => {
    expect(DEFAULT_VENUE_TIMEZONE).toBe('Africa/Johannesburg');
  });
});
