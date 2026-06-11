/**
 * Album-art colour extraction for the now-playing ambient visualiser.
 *
 * Apple MusicKit never exposes the decoded audio stream to the browser (DRM),
 * so we can't build a true FFT visualiser. Instead the "reacts to the song"
 * effect is driven by the *colours of the current track's artwork* — exactly
 * how Apple Music / Spotify ambient modes work. This module turns an artwork
 * URL into a small, vivid palette.
 *
 * Robustness is the whole game here:
 *   - Artwork is cross-origin (mzstatic / picsum). We request it with
 *     crossOrigin='anonymous'; if the host doesn't send CORS headers the canvas
 *     becomes "tainted" and getImageData throws. We catch that.
 *   - No artwork, canvas unsupported, decode error → all handled.
 * In every failure case we fall back to a *deterministic* palette derived from
 * a seed string (song id/title), so the same song always gets the same colours
 * and it reads as intentional rather than random or broken.
 */

// Brand-leaning default if we have nothing at all to seed from.
export const DEFAULT_PALETTE = ['#8b5cf6', '#6366f1', '#a855f7'];

/**
 * FNV-1a 32-bit hash → stable unsigned int from a string. Used to derive a
 * deterministic hue for the fallback palette.
 */
export function hashString(str = '') {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** HSL (h 0-360, s/l 0-100) → #rrggbb. */
export function hslToHex(h, s, l) {
  const sN = s / 100;
  const lN = l / 100;
  const k = (n) => (n + h / 30) % 12;
  const a = sN * Math.min(lN, 1 - lN);
  const f = (n) => {
    const color = lN - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
    return Math.round(255 * color)
      .toString(16)
      .padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

/**
 * Deterministic three-colour palette from a seed string. Picks a base hue and
 * two analogous/complementary partners so the aura has depth, not one flat wash.
 */
export function fallbackPalette(seed = '') {
  if (!seed) return DEFAULT_PALETTE.slice();
  const hue = hashString(seed) % 360;
  return [
    hslToHex(hue, 68, 56),
    hslToHex((hue + 32) % 360, 60, 46),
    hslToHex((hue + 326) % 360, 56, 52),
  ];
}

function componentToHex(c) {
  return Math.max(0, Math.min(255, Math.round(c))).toString(16).padStart(2, '0');
}
function rgbToHex(r, g, b) {
  return `#${componentToHex(r)}${componentToHex(g)}${componentToHex(b)}`;
}

/** Minimal RGB→HSL, returns { h:0-360, s:0-1, l:0-1 }. */
function rgbToHsl(r, g, b) {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === rn) h = (gn - bn) / d + (gn < bn ? 6 : 0);
    else if (max === gn) h = (bn - rn) / d + 2;
    else h = (rn - gn) / d + 4;
    h *= 60;
  }
  return { h, s, l };
}

/**
 * Reduce raw RGBA pixel data to up to `swatches` dominant, vivid colours.
 *
 * Pure and unit-testable: pass any array-like of RGBA bytes. Strategy:
 *   - skip near-transparent and near-grey/black/white pixels (they make the
 *     aura muddy);
 *   - bin the rest into 24 hue buckets, accumulating an RGB sum weighted by
 *     saturation so punchy colours win;
 *   - return the heaviest buckets' average colours, brightest first.
 * Returns [] when the image is essentially colourless so callers fall back.
 */
export function quantizeColors(data, { swatches = 3 } = {}) {
  const BINS = 24;
  const bins = Array.from({ length: BINS }, () => ({ r: 0, g: 0, b: 0, w: 0 }));

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const alpha = data[i + 3];
    if (alpha < 125) continue; // mostly transparent

    const { h, s, l } = rgbToHsl(r, g, b);
    if (s < 0.18) continue; // greyish — no useful hue
    if (l < 0.12 || l > 0.92) continue; // near-black / near-white

    const bin = Math.min(BINS - 1, Math.floor((h / 360) * BINS));
    const weight = s; // saturation-weighted so vivid pixels dominate
    bins[bin].r += r * weight;
    bins[bin].g += g * weight;
    bins[bin].b += b * weight;
    bins[bin].w += weight;
  }

  return bins
    .filter((bin) => bin.w > 0)
    .sort((a, b) => b.w - a.w)
    .slice(0, swatches)
    .map((bin) => ({
      hex: rgbToHex(bin.r / bin.w, bin.g / bin.w, bin.b / bin.w),
      lum: 0.299 * (bin.r / bin.w) + 0.587 * (bin.g / bin.w) + 0.114 * (bin.b / bin.w),
    }))
    .sort((a, b) => b.lum - a.lum)
    .map((c) => c.hex);
}

/**
 * Load an artwork URL and resolve to a palette (array of hex strings, brightest
 * first). Never rejects — on any failure (no URL, CORS taint, decode error,
 * colourless image, SSR/no-canvas) it resolves to the deterministic fallback
 * built from `seed`.
 */
export function extractPalette(url, seed = '') {
  return new Promise((resolve) => {
    const fallback = () => resolve(fallbackPalette(seed || url || ''));

    if (!url || typeof document === 'undefined') {
      fallback();
      return;
    }

    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.decoding = 'async';

    img.onload = () => {
      try {
        const size = 28; // tiny — we only need average colour, not detail
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) {
          fallback();
          return;
        }
        ctx.drawImage(img, 0, 0, size, size);
        const { data } = ctx.getImageData(0, 0, size, size); // throws if tainted
        const palette = quantizeColors(data, { swatches: 3 });
        resolve(palette.length ? palette : fallbackPalette(seed || url));
      } catch {
        fallback(); // tainted canvas or any read error
      }
    };
    img.onerror = fallback;
    img.src = url;
  });
}
