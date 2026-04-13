import { describe, it, expect } from 'vitest';
import { PLAYER_STATES, ERROR_PRIORITY, ERRORS } from './constants';

describe('PLAYER_STATES', () => {
  it('has all required states', () => {
    expect(PLAYER_STATES.NOT_READY).toBe('notReady');
    expect(PLAYER_STATES.IDLE).toBe('idle');
    expect(PLAYER_STATES.WAITING).toBe('waitingForGesture');
    expect(PLAYER_STATES.TRANSITIONING).toBe('transitioning');
    expect(PLAYER_STATES.PLAYING).toBe('playing');
    expect(PLAYER_STATES.PAUSED).toBe('paused');
  });

  it('has exactly 6 states — adding a state requires updating tests', () => {
    expect(Object.keys(PLAYER_STATES)).toHaveLength(6);
  });

  it('all values are unique', () => {
    const values = Object.values(PLAYER_STATES);
    expect(new Set(values).size).toBe(values.length);
  });
});

describe('ERROR_PRIORITY', () => {
  it('network errors have highest priority (1)', () => {
    expect(ERROR_PRIORITY[ERRORS.NO_INTERNET]).toBe(1);
    expect(ERROR_PRIORITY[ERRORS.SLOW_INTERNET]).toBe(1);
  });

  it('priorities are ordered: network < connect < attention < disconnect < generic < playback', () => {
    expect(ERROR_PRIORITY[ERRORS.NO_INTERNET]).toBeLessThan(ERROR_PRIORITY[ERRORS.APPLE_CONNECT]);
    expect(ERROR_PRIORITY[ERRORS.APPLE_CONNECT]).toBeLessThan(ERROR_PRIORITY[ERRORS.NEEDS_ATTENTION]);
    expect(ERROR_PRIORITY[ERRORS.NEEDS_ATTENTION]).toBeLessThan(ERROR_PRIORITY[ERRORS.DISCONNECTED]);
    expect(ERROR_PRIORITY[ERRORS.DISCONNECTED]).toBeLessThan(ERROR_PRIORITY[ERRORS.GENERIC_RETRY]);
    expect(ERROR_PRIORITY[ERRORS.GENERIC_RETRY]).toBeLessThan(ERROR_PRIORITY[ERRORS.PLAYBACK_FAILED]);
  });

  it('every ERRORS constant has a matching ERROR_PRIORITY entry', () => {
    for (const msg of Object.values(ERRORS)) {
      expect(ERROR_PRIORITY[msg]).toBeDefined();
    }
  });
});
