import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import Waveform from './Waveform';
import SongAura from './SongAura';

describe('Waveform', () => {
  it('renders the requested number of bars', () => {
    const { container } = render(<Waveform palette={['#ff0000']} bars={6} />);
    // Outer wrapper span + one span per bar.
    const bars = container.querySelectorAll('span > span');
    expect(bars).toHaveLength(6);
  });

  it('is hidden from assistive tech (decorative)', () => {
    const { container } = render(<Waveform palette={['#ff0000']} />);
    expect(container.firstChild.getAttribute('aria-hidden')).toBe('true');
  });

  it('runs the bar animation while playing and pauses it when stopped', () => {
    const playing = render(<Waveform palette={['#ff0000']} playing bars={1} />);
    const playingBar = playing.container.querySelector('span > span');
    expect(playingBar.style.animationPlayState).toBe('running');

    const paused = render(<Waveform palette={['#ff0000']} playing={false} bars={1} />);
    const pausedBar = paused.container.querySelector('span > span');
    expect(pausedBar.style.animationPlayState).toBe('paused');
    // Paused bars settle to a low resting height.
    expect(pausedBar.style.transform).toMatch(/scaleY/);
  });

  it('colours bars from the palette, cycling when there are more bars than colours', () => {
    const { container } = render(<Waveform palette={['#ff0000', '#00ff00']} bars={4} />);
    const bars = container.querySelectorAll('span > span');
    // jsdom normalises hex to rgb in style.backgroundColor.
    expect(bars[0].style.backgroundColor).toBe('rgb(255, 0, 0)');
    expect(bars[1].style.backgroundColor).toBe('rgb(0, 255, 0)');
    expect(bars[2].style.backgroundColor).toBe('rgb(255, 0, 0)');
  });
});

describe('SongAura', () => {
  it('renders a decorative canvas without crashing when 2D context is unavailable', () => {
    // jsdom has no canvas backend; the component must guard getContext()===null.
    const { container } = render(<SongAura palette={['#ff0000', '#00ff00']} playing />);
    const canvas = container.querySelector('canvas');
    expect(canvas).not.toBeNull();
    expect(canvas.getAttribute('aria-hidden')).toBe('true');
  });
});
