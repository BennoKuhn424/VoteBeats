import { describe, it, expect } from 'vitest';
import {
  hashString,
  hslToHex,
  fallbackPalette,
  quantizeColors,
  extractPalette,
  DEFAULT_PALETTE,
} from './albumColors';

describe('hashString', () => {
  it('is deterministic for the same input', () => {
    expect(hashString('Bohemian Rhapsody')).toBe(hashString('Bohemian Rhapsody'));
  });

  it('differs for different inputs', () => {
    expect(hashString('a')).not.toBe(hashString('b'));
  });

  it('returns an unsigned 32-bit integer', () => {
    const h = hashString('anything');
    expect(h).toBeGreaterThanOrEqual(0);
    expect(h).toBeLessThanOrEqual(0xffffffff);
    expect(Number.isInteger(h)).toBe(true);
  });
});

describe('hslToHex', () => {
  it('converts primary colours correctly', () => {
    expect(hslToHex(0, 100, 50)).toBe('#ff0000');
    expect(hslToHex(120, 100, 50)).toBe('#00ff00');
    expect(hslToHex(240, 100, 50)).toBe('#0000ff');
  });

  it('produces black and white at the lightness extremes', () => {
    expect(hslToHex(0, 100, 0)).toBe('#000000');
    expect(hslToHex(0, 100, 100)).toBe('#ffffff');
  });

  it('always returns a 7-char hex string', () => {
    for (let h = 0; h < 360; h += 37) {
      expect(hslToHex(h, 65, 55)).toMatch(/^#[0-9a-f]{6}$/);
    }
  });
});

describe('fallbackPalette', () => {
  it('returns the brand default for an empty seed', () => {
    expect(fallbackPalette('')).toEqual(DEFAULT_PALETTE);
  });

  it('does not return a reference to the shared default array (no mutation leak)', () => {
    const p = fallbackPalette('');
    expect(p).not.toBe(DEFAULT_PALETTE);
  });

  it('is deterministic for a given seed', () => {
    expect(fallbackPalette('song-42')).toEqual(fallbackPalette('song-42'));
  });

  it('gives different seeds different palettes', () => {
    expect(fallbackPalette('song-1')).not.toEqual(fallbackPalette('song-99'));
  });

  it('returns three valid hex colours', () => {
    const p = fallbackPalette('hello');
    expect(p).toHaveLength(3);
    p.forEach((c) => expect(c).toMatch(/^#[0-9a-f]{6}$/));
  });
});

describe('quantizeColors', () => {
  // Helper: build an RGBA buffer that repeats a single colour.
  const fill = (r, g, b, count, a = 255) => {
    const arr = new Uint8ClampedArray(count * 4);
    for (let i = 0; i < count; i += 1) {
      arr[i * 4] = r;
      arr[i * 4 + 1] = g;
      arr[i * 4 + 2] = b;
      arr[i * 4 + 3] = a;
    }
    return arr;
  };

  it('extracts a dominant vivid colour', () => {
    const palette = quantizeColors(fill(220, 30, 30, 50)); // strong red
    expect(palette.length).toBeGreaterThan(0);
    expect(palette[0]).toMatch(/^#[0-9a-f]{6}$/);
    // Red channel should clearly dominate the returned swatch.
    const [r, , bch] = [palette[0].slice(1, 3), palette[0].slice(3, 5), palette[0].slice(5, 7)].map(
      (h) => parseInt(h, 16)
    );
    expect(r).toBeGreaterThan(bch);
  });

  it('returns nothing for a greyscale image (no usable hue)', () => {
    expect(quantizeColors(fill(128, 128, 128, 50))).toEqual([]);
  });

  it('skips near-transparent pixels', () => {
    expect(quantizeColors(fill(220, 30, 30, 50, 10))).toEqual([]);
  });

  it('skips near-black and near-white pixels', () => {
    expect(quantizeColors(fill(4, 4, 6, 50))).toEqual([]);
    expect(quantizeColors(fill(252, 252, 250, 50))).toEqual([]);
  });

  it('caps the number of swatches', () => {
    // Three distinct vivid hues interleaved.
    const arr = new Uint8ClampedArray(60 * 4);
    const colors = [
      [220, 30, 30],
      [30, 200, 30],
      [40, 40, 220],
    ];
    for (let i = 0; i < 60; i += 1) {
      const [r, g, b] = colors[i % 3];
      arr[i * 4] = r;
      arr[i * 4 + 1] = g;
      arr[i * 4 + 2] = b;
      arr[i * 4 + 3] = 255;
    }
    expect(quantizeColors(arr, { swatches: 2 }).length).toBeLessThanOrEqual(2);
  });
});

describe('extractPalette', () => {
  it('falls back to the deterministic palette when there is no URL', async () => {
    const palette = await extractPalette('', 'seed-song');
    expect(palette).toEqual(fallbackPalette('seed-song'));
  });

  it('never rejects', async () => {
    await expect(extractPalette(undefined, 'x')).resolves.toBeInstanceOf(Array);
  });
});
