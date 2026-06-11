import { useMemo } from 'react';

/**
 * Synthesized equalizer bars — the rhythmic half of the now-playing visualiser.
 *
 * Honest by design: MusicKit doesn't expose the audio, so these bars are NOT
 * reading real frequencies. They animate while `playing` and rest flat when
 * paused, signalling "music is on" the way a hi-fi VU meter does — decorative,
 * never claiming to be a true spectrum. Colours come from the track's artwork
 * palette so it still feels tied to the song.
 *
 * Pure CSS (the shared `eq` keyframe), so it's effectively free and the global
 * reduced-motion net already settles the bars to a calm low rest state.
 * aria-hidden — the surrounding text conveys play state to assistive tech.
 */
export default function Waveform({ palette = ['#8b5cf6'], playing = false, bars = 9, className = '' }) {
  // Stable per-bar timing/height so the row looks organic but doesn't reshuffle
  // on every render. Recomputed only if the bar count changes.
  const shape = useMemo(
    () =>
      Array.from({ length: bars }, (_, i) => {
        const wobble = Math.sin(i * 12.9898) * 43758.5453;
        const frac = wobble - Math.floor(wobble); // deterministic 0..1
        return {
          duration: 900 + Math.round(frac * 700), // 0.9s–1.6s
          delay: Math.round(frac * 600), // staggered start
          rest: 0.22 + frac * 0.25, // paused height fraction
        };
      }),
    [bars]
  );

  return (
    <span aria-hidden="true" className={`flex items-end gap-[3px] ${className}`}>
      {shape.map((b, i) => {
        const color = palette[i % palette.length] || '#8b5cf6';
        return (
          <span
            key={i}
            className="w-[3px] h-full origin-bottom rounded-full animate-eq"
            style={{
              backgroundColor: color,
              animationDuration: `${b.duration}ms`,
              animationDelay: `${b.delay}ms`,
              // Freeze low and stop animating when paused; the gentle bounce only
              // plays with the music.
              transform: playing ? undefined : `scaleY(${b.rest})`,
              animationPlayState: playing ? 'running' : 'paused',
              opacity: playing ? 1 : 0.55,
              transition: 'transform 400ms ease, opacity 400ms ease',
            }}
          />
        );
      })}
    </span>
  );
}
