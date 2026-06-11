import { useEffect, useRef } from 'react';

/**
 * Ambient "now playing" backdrop: soft coloured light that drifts and breathes
 * behind the player, painted from the current track's artwork palette.
 *
 * This is the album-art half of the song-reactive visualiser. Apple MusicKit
 * won't give us the audio stream, so reactivity comes from:
 *   - colour      → pulled from THIS song's artwork (see useAlbumPalette)
 *   - motion      → drifts + breathes while `playing`, freezes on pause
 *   - reduced-motion → renders a single static frame, no rAF loop
 *
 * Purely decorative, so aria-hidden and pointer-events:none. Cheap by design:
 * a handful of additive radial gradients on a low-res canvas, throttled to
 * ~30fps and CSS-blurred for softness, so it's fine on venue tablets.
 */
export default function SongAura({ palette, playing = false, opacity = 0.9, className = '' }) {
  const canvasRef = useRef(null);
  const rafRef = useRef(0);
  // Keep latest props in refs so the rAF loop doesn't need to be torn down and
  // rebuilt on every play/pause or palette change.
  const paletteRef = useRef(palette);
  const playingRef = useRef(playing);
  paletteRef.current = palette && palette.length ? palette : ['#8b5cf6'];
  playingRef.current = playing;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const ctx = canvas.getContext && canvas.getContext('2d');
    if (!ctx) return undefined; // jsdom / unsupported — render nothing, no crash

    const reduceMotion =
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    let width = 0;
    let height = 0;
    const resize = () => {
      // Render at low resolution; the element is CSS-scaled + blurred, so detail
      // is wasted. Caps cost on big screens.
      const rect = canvas.getBoundingClientRect();
      width = Math.max(1, Math.round(rect.width / 3));
      height = Math.max(1, Math.round(rect.height / 3));
      canvas.width = width;
      canvas.height = height;
    };
    resize();

    // Each palette colour becomes a blob orbiting on its own slow Lissajous path.
    const blobs = [0, 1, 2].map((i) => ({
      cx: 0.3 + 0.4 * ((i * 0.37) % 1),
      cy: 0.35 + 0.3 * ((i * 0.53) % 1),
      ax: 0.18 + 0.06 * i,
      ay: 0.14 + 0.05 * i,
      sx: 0.00007 + i * 0.00002,
      sy: 0.00009 + i * 0.000015,
      phase: i * 2.1,
    }));

    const draw = (t) => {
      const colors = paletteRef.current;
      ctx.clearRect(0, 0, width, height);
      // Breathing: radius gently swells/contracts; only advances while playing.
      const breathe = 0.5 + 0.5 * Math.sin(t * 0.0011);
      const radius = Math.max(width, height) * (0.55 + 0.12 * breathe);
      ctx.globalCompositeOperation = 'lighter';
      blobs.forEach((b, i) => {
        const color = colors[i % colors.length];
        const x = (b.cx + b.ax * Math.sin(t * b.sx + b.phase)) * width;
        const y = (b.cy + b.ay * Math.cos(t * b.sy + b.phase)) * height;
        const g = ctx.createRadialGradient(x, y, 0, x, y, radius);
        g.addColorStop(0, hexToRgba(color, 0.55));
        g.addColorStop(0.6, hexToRgba(color, 0.16));
        g.addColorStop(1, hexToRgba(color, 0));
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, width, height);
      });
      ctx.globalCompositeOperation = 'source-over';
    };

    // Static render for paused / reduced-motion: one calm frame, no loop.
    if (reduceMotion) {
      draw(1500);
      return () => {};
    }

    let last = 0;
    let frozenAt = null; // timestamp we paused at, so the frozen frame holds
    const FRAME_MS = 33; // ~30fps cap
    const loop = (now) => {
      rafRef.current = requestAnimationFrame(loop);
      if (now - last < FRAME_MS) return;
      last = now;
      if (playingRef.current) {
        frozenAt = null;
        draw(now);
      } else if (frozenAt === null) {
        frozenAt = now;
        draw(now); // paint the freeze frame once, then idle
      }
    };
    rafRef.current = requestAnimationFrame(loop);

    let ro;
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(resize);
      ro.observe(canvas);
    }

    return () => {
      cancelAnimationFrame(rafRef.current);
      if (ro) ro.disconnect();
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className={`pointer-events-none absolute inset-0 h-full w-full ${className}`}
      style={{ filter: 'blur(28px)', opacity }}
    />
  );
}

/** '#rrggbb' + alpha → 'rgba(r,g,b,a)'. Tolerates a missing/short hex. */
function hexToRgba(hex, alpha) {
  let h = (hex || '').replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  if (h.length !== 6) return `rgba(139,92,246,${alpha})`;
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}
