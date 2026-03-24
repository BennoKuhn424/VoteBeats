const { slotMatches } = require('../utils/playlistSchedule');

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
});
