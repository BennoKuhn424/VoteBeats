const { slotMatches, findScheduledPlaylist, findScheduleOverlap } = require('../utils/playlistSchedule');

describe('slotMatches', () => {
  test('hour-only slot 9–17 matches 10:30', () => {
    const d = new Date(2025, 0, 15, 10, 30, 0);
    expect(slotMatches({ startHour: 9, endHour: 17, startMinute: 0, endMinute: 0 }, d)).toBe(true);
  });

  test('excludes end boundary', () => {
    const d = new Date(2025, 0, 15, 17, 0, 0);
    expect(slotMatches({ startHour: 9, endHour: 17, startMinute: 0, endMinute: 0 }, d)).toBe(false);
  });

  test('days filter', () => {
    // Wednesday Jan 15 2025
    const wed = new Date(2025, 0, 15, 12, 0, 0);
    expect(slotMatches({ startHour: 0, endHour: 23, days: [3] }, wed)).toBe(true); // Wed = 3
    expect(slotMatches({ startHour: 0, endHour: 23, days: [1] }, wed)).toBe(false);
  });

  test('overnight 22:00–02:00', () => {
    expect(slotMatches({ startHour: 22, endHour: 2, startMinute: 0, endMinute: 0 }, new Date(2025, 0, 15, 23, 0, 0))).toBe(true);
    expect(slotMatches({ startHour: 22, endHour: 2, startMinute: 0, endMinute: 0 }, new Date(2025, 0, 15, 1, 0, 0))).toBe(true);
    expect(slotMatches({ startHour: 22, endHour: 2, startMinute: 0, endMinute: 0 }, new Date(2025, 0, 15, 12, 0, 0))).toBe(false);
  });

  test('overnight day filter uses the day the slot started', () => {
    // Thursday Jan 16 2025 at 01:00 is still inside Wednesday night's slot.
    const thuEarly = new Date(2025, 0, 16, 1, 0, 0);
    expect(slotMatches({ startHour: 22, endHour: 2, days: [3] }, thuEarly)).toBe(true); // Wed = 3
    expect(slotMatches({ startHour: 22, endHour: 2, days: [4] }, thuEarly)).toBe(false); // Thu = 4
  });
});

describe('findScheduledPlaylist', () => {
  const playlists = [
    { id: 'breakfast', name: 'Breakfast', songs: [{ id: 'b1' }] },
    { id: 'dinner', name: 'Dinner', songs: [{ id: 'd1' }] },
    { id: 'empty', name: 'Empty', songs: [] },
  ];

  test('returns the first non-empty playlist whose slot matches now', () => {
    const schedule = [
      { playlistId: 'dinner', startHour: 18, endHour: 23 },
      { playlistId: 'breakfast', startHour: 8, endHour: 11 },
    ];

    expect(findScheduledPlaylist(schedule, playlists, new Date(2025, 0, 15, 9, 30, 0))).toMatchObject({
      id: 'breakfast',
    });
  });

  test('skips matching slots that point to empty or missing playlists', () => {
    const schedule = [
      { playlistId: 'empty', startHour: 9, endHour: 17 },
      { playlistId: 'missing', startHour: 9, endHour: 17 },
    ];

    expect(findScheduledPlaylist(schedule, playlists, new Date(2025, 0, 15, 10, 0, 0))).toBeNull();
  });

  test('returns the first matching slot when two playlists overlap the same window', () => {
    // Real-world dayparting: lunch (12–14) and afternoon (13–17) overlap at 13:30.
    // First slot in the array wins.
    const schedule = [
      { playlistId: 'breakfast', startHour: 12, endHour: 14 },
      { playlistId: 'dinner', startHour: 13, endHour: 17 },
    ];

    expect(findScheduledPlaylist(schedule, playlists, new Date(2025, 0, 15, 13, 30, 0))).toMatchObject({
      id: 'breakfast',
    });
  });

  test('falls through to a later non-empty slot when an earlier matching slot is empty', () => {
    const schedule = [
      { playlistId: 'empty', startHour: 9, endHour: 17 },
      { playlistId: 'breakfast', startHour: 9, endHour: 17 },
    ];

    expect(findScheduledPlaylist(schedule, playlists, new Date(2025, 0, 15, 10, 0, 0))).toMatchObject({
      id: 'breakfast',
    });
  });
});

describe('slotMatches edge cases', () => {
  test('defaults missing startMinute and endMinute to 0', () => {
    // Slot with only startHour/endHour (no minute keys at all) should match the same as 0-minute slots.
    const at0930 = new Date(2025, 0, 15, 9, 30, 0);
    expect(slotMatches({ startHour: 9, endHour: 17 }, at0930)).toBe(true);

    // And the end-boundary exclusion still applies with defaulted minutes.
    const at1700 = new Date(2025, 0, 15, 17, 0, 0);
    expect(slotMatches({ startHour: 9, endHour: 17 }, at1700)).toBe(false);
  });
});

describe('findScheduleOverlap', () => {
  test('returns null for adjacent non-overlapping slots', () => {
    expect(findScheduleOverlap([
      { playlistId: 'morning', startHour: 9, endHour: 12, days: [6] },
      { playlistId: 'lunch', startHour: 12, endHour: 14, days: [6] },
    ])).toBeNull();
  });

  test('detects overlap on the same day', () => {
    const overlap = findScheduleOverlap([
      { playlistId: 'lunch', startHour: 12, endHour: 14, days: [6] },
      { playlistId: 'afternoon', startHour: 13, endHour: 17, days: [6] },
    ]);

    expect(overlap).toMatchObject({ firstIndex: 0, secondIndex: 1 });
  });

  test('detects overnight overlap into the next day', () => {
    const overlap = findScheduleOverlap([
      { playlistId: 'late', startHour: 22, endHour: 2, days: [5] },
      { playlistId: 'early', startHour: 1, endHour: 3, days: [6] },
    ]);

    expect(overlap).toMatchObject({ firstIndex: 0, secondIndex: 1 });
  });

  test('treats omitted days as every day when checking overlaps', () => {
    const overlap = findScheduleOverlap([
      { playlistId: 'daily', startHour: 9, endHour: 10 },
      { playlistId: 'saturday', startHour: 9, endHour: 10, days: [6] },
    ]);

    expect(overlap).toMatchObject({ firstIndex: 0, secondIndex: 1 });
  });

  test('detects Sat→Sun overnight wraparound conflicting with a Sunday daily slot', () => {
    // Saturday 22:00 → 02:00 wraps into Sunday 00:00–02:00.
    // A Sunday-only slot at 01:00–02:00 must conflict with that wrap.
    const overlap = findScheduleOverlap([
      { playlistId: 'sat-night', startHour: 22, endHour: 2, days: [6] },
      { playlistId: 'sun-early', startHour: 1, endHour: 2, days: [0] },
    ]);

    expect(overlap).toMatchObject({ firstIndex: 0, secondIndex: 1 });
  });

  test('allows back-to-back overnight slots that share an end/start boundary', () => {
    // Friday 22:00–02:00 (ends Sat 02:00) and Saturday 02:00–06:00 are adjacent, not overlapping.
    expect(findScheduleOverlap([
      { playlistId: 'late-fri', startHour: 22, endHour: 2, days: [5] },
      { playlistId: 'early-sat', startHour: 2, endHour: 6, days: [6] },
    ])).toBeNull();
  });

  test('allows the same time slot on different days', () => {
    expect(findScheduleOverlap([
      { playlistId: 'mon-lunch', startHour: 12, endHour: 14, days: [1] },
      { playlistId: 'tue-lunch', startHour: 12, endHour: 14, days: [2] },
    ])).toBeNull();
  });

  test('is order-independent: detects overlap regardless of which slot comes first', () => {
    const overlapA = findScheduleOverlap([
      { playlistId: 'a', startHour: 13, endHour: 17, days: [6] },
      { playlistId: 'b', startHour: 12, endHour: 14, days: [6] },
    ]);
    const overlapB = findScheduleOverlap([
      { playlistId: 'b', startHour: 12, endHour: 14, days: [6] },
      { playlistId: 'a', startHour: 13, endHour: 17, days: [6] },
    ]);
    expect(overlapA).not.toBeNull();
    expect(overlapB).not.toBeNull();
  });

  test('rejects two slots booking the exact same time/day window', () => {
    expect(findScheduleOverlap([
      { playlistId: 'dinner-a', startHour: 18, endHour: 23, days: [6] },
      { playlistId: 'dinner-b', startHour: 18, endHour: 23, days: [6] },
    ])).not.toBeNull();
  });

  test('returns null for empty or single-slot schedules', () => {
    expect(findScheduleOverlap([])).toBeNull();
    expect(findScheduleOverlap([{ playlistId: 'only', startHour: 9, endHour: 17 }])).toBeNull();
  });
});

describe('slotMatches end-exclusive boundary for overnight slots', () => {
  test('overnight 22:00–02:00 does NOT match at 02:00 sharp on the next day', () => {
    const at0200 = new Date(2025, 0, 16, 2, 0, 0); // Thu 02:00
    expect(slotMatches({ startHour: 22, endHour: 2 }, at0200)).toBe(false);
  });

  test('overnight slot matches at 23:59 on its start day', () => {
    const at2359 = new Date(2025, 0, 15, 23, 59, 0); // Wed 23:59
    expect(slotMatches({ startHour: 22, endHour: 2 }, at2359)).toBe(true);
  });

  test('overnight slot matches at 00:00 on the next day', () => {
    const at0000 = new Date(2025, 0, 16, 0, 0, 0); // Thu 00:00
    expect(slotMatches({ startHour: 22, endHour: 2 }, at0000)).toBe(true);
  });
});
