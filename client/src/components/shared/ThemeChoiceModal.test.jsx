import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider } from '../../context/ThemeContext';
import ThemeChoiceModal from './ThemeChoiceModal';

vi.mock('../../utils/api', () => ({
  default: {
    setVenueTheme: vi.fn().mockResolvedValue({ data: { theme: 'dark' } }),
  },
}));

describe('ThemeChoiceModal', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.classList.remove('dark');
  });

  it('renders when no theme is chosen yet', () => {
    render(
      <ThemeProvider>
        <ThemeChoiceModal />
      </ThemeProvider>,
    );
    expect(screen.getByText(/pick your look/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Light/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Dark/i })).toBeInTheDocument();
  });

  it('does not render when a theme is already stored', () => {
    localStorage.setItem('speeldit_theme', 'light');
    render(
      <ThemeProvider>
        <ThemeChoiceModal />
      </ThemeProvider>,
    );
    expect(screen.queryByText(/pick your look/i)).not.toBeInTheDocument();
  });

  it('picks dark and dismisses itself', async () => {
    const user = userEvent.setup();
    render(
      <ThemeProvider>
        <ThemeChoiceModal />
      </ThemeProvider>,
    );
    await user.click(screen.getByRole('button', { name: /^Dark/i }));
    expect(screen.queryByText(/pick your look/i)).not.toBeInTheDocument();
    expect(localStorage.getItem('speeldit_theme')).toBe('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });

  it('picks light and dismisses itself', async () => {
    const user = userEvent.setup();
    render(
      <ThemeProvider>
        <ThemeChoiceModal />
      </ThemeProvider>,
    );
    await user.click(screen.getByRole('button', { name: /^Light/i }));
    expect(screen.queryByText(/pick your look/i)).not.toBeInTheDocument();
    expect(localStorage.getItem('speeldit_theme')).toBe('light');
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });
});
