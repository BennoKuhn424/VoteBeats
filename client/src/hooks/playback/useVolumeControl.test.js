import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useVolumeControl } from './useVolumeControl';

vi.mock('../../utils/api', () => ({
  default: {
    reportPlayerVolume: vi.fn(() => Promise.resolve()),
  },
}));

describe('useVolumeControl', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('defaults to 70 when localStorage is empty', () => {
    const refs = { music: null };
    const { result } = renderHook(() => useVolumeControl(refs, 'V1'));
    expect(result.current.volume).toBe(70);
  });

  it('reads initial volume from localStorage', () => {
    localStorage.setItem('speeldit_volume', '42');
    const refs = { music: null };
    const { result } = renderHook(() => useVolumeControl(refs, 'V1'));
    expect(result.current.volume).toBe(42);
  });

  it('clamps values > 100 to 100', () => {
    localStorage.setItem('speeldit_volume', '150');
    const refs = { music: null };
    const { result } = renderHook(() => useVolumeControl(refs, 'V1'));
    expect(result.current.volume).toBe(100);
  });

  it('treats NaN as default 70', () => {
    localStorage.setItem('speeldit_volume', 'abc');
    const refs = { music: null };
    const { result } = renderHook(() => useVolumeControl(refs, 'V1'));
    expect(result.current.volume).toBe(70);
  });

  it('treats negative values as default 70', () => {
    localStorage.setItem('speeldit_volume', '-5');
    const refs = { music: null };
    const { result } = renderHook(() => useVolumeControl(refs, 'V1'));
    expect(result.current.volume).toBe(70);
  });

  it('persists volume changes to localStorage', () => {
    const refs = { music: null };
    const { result } = renderHook(() => useVolumeControl(refs, 'V1'));

    act(() => { result.current.setVolume(55); });
    expect(localStorage.getItem('speeldit_volume')).toBe('55');
  });

  it('syncs volume to MusicKit instance', () => {
    const music = { volume: 0.7 };
    const refs = { music };
    const { result } = renderHook(() => useVolumeControl(refs, 'V1'));

    act(() => { result.current.setVolume(30); });
    expect(music.volume).toBeCloseTo(0.3);
  });
});
