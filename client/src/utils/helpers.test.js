import { describe, it, expect } from 'vitest';
import { formatDuration, formatTimeAgo } from './helpers';

describe('formatDuration', () => {
  it('formats whole minutes and seconds', () => {
    expect(formatDuration(0)).toBe('0:00');
    expect(formatDuration(82)).toBe('1:22');
    expect(formatDuration(189)).toBe('3:09');
  });

  it('pads seconds', () => {
    expect(formatDuration(61)).toBe('1:01');
  });

  it('handles invalid input', () => {
    expect(formatDuration(NaN)).toBe('0:00');
    expect(formatDuration(-1)).toBe('0:00');
    expect(formatDuration(Infinity)).toBe('0:00');
  });
});

describe('formatTimeAgo', () => {
  it('returns empty for invalid date', () => {
    expect(formatTimeAgo('not-a-date')).toBe('');
  });
});
