import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider, useTheme } from './ThemeContext';

// Mock the api module because ThemeProvider.setTheme calls api.setVenueTheme
vi.mock('../utils/api', () => ({
  default: {
    setVenueTheme: vi.fn().mockResolvedValue({ data: { theme: 'dark' } }),
  },
}));

function Probe() {
  const { theme, rawTheme, needsChoice, setTheme, hydrateFromServer } = useTheme();
  return (
    <div>
      <span data-testid="theme">{theme}</span>
      <span data-testid="raw">{rawTheme ?? 'null'}</span>
      <span data-testid="needs">{String(needsChoice)}</span>
      <button type="button" onClick={() => setTheme('dark')}>pick-dark</button>
      <button type="button" onClick={() => setTheme('light')}>pick-light</button>
      <button type="button" onClick={() => hydrateFromServer('dark')}>hydrate-dark</button>
    </div>
  );
}

function renderProvider() {
  return render(
    <ThemeProvider>
      <Probe />
    </ThemeProvider>,
  );
}

describe('ThemeProvider', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.classList.remove('dark');
  });

  it('defaults to light (themed) + needsChoice=true when nothing stored', () => {
    renderProvider();
    expect(screen.getByTestId('theme').textContent).toBe('light');
    expect(screen.getByTestId('raw').textContent).toBe('null');
    expect(screen.getByTestId('needs').textContent).toBe('true');
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });

  it('reads stored theme from localStorage on mount', () => {
    localStorage.setItem('speeldit_theme', 'dark');
    renderProvider();
    expect(screen.getByTestId('theme').textContent).toBe('dark');
    expect(screen.getByTestId('raw').textContent).toBe('dark');
    expect(screen.getByTestId('needs').textContent).toBe('false');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });

  it('ignores invalid stored values', () => {
    localStorage.setItem('speeldit_theme', 'sepia');
    renderProvider();
    expect(screen.getByTestId('raw').textContent).toBe('null');
    expect(screen.getByTestId('needs').textContent).toBe('true');
  });

  it('setTheme writes localStorage, toggles dom class, and clears needsChoice', async () => {
    const user = userEvent.setup();
    renderProvider();
    await user.click(screen.getByText('pick-dark'));
    expect(screen.getByTestId('theme').textContent).toBe('dark');
    expect(screen.getByTestId('needs').textContent).toBe('false');
    expect(localStorage.getItem('speeldit_theme')).toBe('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);

    await user.click(screen.getByText('pick-light'));
    expect(screen.getByTestId('theme').textContent).toBe('light');
    expect(localStorage.getItem('speeldit_theme')).toBe('light');
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });

  it('hydrateFromServer overrides local and stops prompting', () => {
    localStorage.setItem('speeldit_theme', 'light');
    const { rerender } = renderProvider();
    expect(screen.getByTestId('theme').textContent).toBe('light');

    act(() => {
      screen.getByText('hydrate-dark').click();
    });
    rerender(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );

    // After hydrate + re-read from localStorage, theme should be dark.
    expect(localStorage.getItem('speeldit_theme')).toBe('dark');
  });

  it('setTheme gracefully swallows server errors (localStorage remains authoritative)', async () => {
    const api = (await import('../utils/api')).default;
    api.setVenueTheme.mockRejectedValueOnce(new Error('Network down'));

    const user = userEvent.setup();
    renderProvider();
    await user.click(screen.getByText('pick-dark'));

    expect(screen.getByTestId('theme').textContent).toBe('dark');
    expect(localStorage.getItem('speeldit_theme')).toBe('dark');
  });
});
