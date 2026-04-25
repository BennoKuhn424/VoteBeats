const { slotMatches, findScheduledPlaylist } = require('../utils/playlistSchedule');

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
