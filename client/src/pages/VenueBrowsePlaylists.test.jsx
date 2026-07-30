/**
 * Tests for the AI-playlist redemption on VenueBrowsePlaylists.
 *
 * The `speeldit_generate_*` keys in localStorage are the venue's receipt for a
 * payment it has ALREADY made. The page used to delete them the instant the
 * redemption request was fired — so a generation that failed left the venue
 * charged, with nothing delivered and no way to ask for it again. These tests
 * pin the rule: the receipt survives a failure and is cleared only once the
 * songs arrive (or the server says the checkout was already spent).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

const { mockGetVenue, mockGeneratePlaylist } = vi.hoisted(() => ({
  mockGetVenue: vi.fn(),
  mockGeneratePlaylist: vi.fn(),
}));

vi.mock('../utils/api', () => ({
  default: {
    getVenue: (...a) => mockGetVenue(...a),
    generatePlaylist: (...a) => mockGeneratePlaylist(...a),
    getPlaylists: vi.fn().mockResolvedValue({ data: { playlists: [] } }),
  },
}));

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ user: { venueCode: 'VEN001' } }),
}));

vi.mock('../components/venue/PlaylistManager', () => ({ default: () => <div /> }));
vi.mock('../components/venue/PlaylistScheduleModal', () => ({ default: () => null }));

import VenueBrowsePlaylists from './VenueBrowsePlaylists';

const VENUE = 'VEN001';
const KEYS = {
  checkout: `speeldit_generate_${VENUE}`,
  prompt: `speeldit_generate_prompt_${VENUE}`,
  playlist: `speeldit_generate_playlist_${VENUE}`,
  count: `speeldit_generate_count_${VENUE}`,
};

function storeReceipt() {
  localStorage.setItem(KEYS.checkout, 'chk_paid');
  localStorage.setItem(KEYS.prompt, 'sunday jazz');
  localStorage.setItem(KEYS.playlist, 'pl_1');
  localStorage.setItem(KEYS.count, '50');
}

function receiptExists() {
  return localStorage.getItem(KEYS.checkout) !== null;
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/venue/playlists?generatePlaylist=1']}>
      <VenueBrowsePlaylists />
    </MemoryRouter>
  );
}

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  mockGetVenue.mockResolvedValue({ data: { code: VENUE, playlists: [], settings: {} } });
  window.history.replaceState({}, '', '/venue/playlists?generatePlaylist=1');
});

afterEach(() => {
  localStorage.clear();
});

describe('AI playlist redemption — the receipt', () => {
  it('redeems the stored receipt and reports the songs added', async () => {
    storeReceipt();
    mockGeneratePlaylist.mockResolvedValue({ data: { added: [{ id: 'a' }, { id: 'b' }] } });

    renderPage();

    await waitFor(() => expect(mockGeneratePlaylist).toHaveBeenCalledWith(
      VENUE, 'pl_1', 'chk_paid', 'sunday jazz', 50
    ));
    expect(await screen.findByText(/Added 2 songs/i)).toBeInTheDocument();
  });

  it('clears the receipt once the songs are delivered', async () => {
    storeReceipt();
    mockGeneratePlaylist.mockResolvedValue({ data: { added: [] } });

    renderPage();

    await waitFor(() => expect(receiptExists()).toBe(false));
  });

  // The money bug: a failed generation used to destroy the only proof of
  // payment the venue had.
  it('KEEPS the receipt when the generation fails', async () => {
    storeReceipt();
    mockGeneratePlaylist.mockRejectedValue({ response: { data: { error: 'AI unavailable' } } });

    renderPage();

    await waitFor(() => expect(screen.getByText(/AI unavailable/i)).toBeInTheDocument());
    expect(receiptExists()).toBe(true);
    expect(localStorage.getItem(KEYS.prompt)).toBe('sunday jazz');
  });

  it('tells the venue its payment is safe and offers a retry', async () => {
    storeReceipt();
    mockGeneratePlaylist.mockRejectedValue({ response: { data: { error: 'AI unavailable' } } });

    renderPage();

    expect(await screen.findByText(/your payment is safe/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
  });

  it('the retry redeems the same checkout and succeeds', async () => {
    storeReceipt();
    mockGeneratePlaylist.mockRejectedValueOnce({ response: { data: { error: 'AI unavailable' } } });

    renderPage();
    const retry = await screen.findByRole('button', { name: /try again/i });

    mockGeneratePlaylist.mockResolvedValue({ data: { added: [{ id: 'a' }] } });
    await userEvent.click(retry);

    await waitFor(() => expect(screen.getByText(/Added 1 songs/i)).toBeInTheDocument());
    expect(mockGeneratePlaylist).toHaveBeenCalledTimes(2);
    expect(mockGeneratePlaylist.mock.calls[1][2]).toBe('chk_paid');
    expect(receiptExists()).toBe(false);
  });

  // Already delivered — a retry could never succeed, so holding the receipt
  // would only offer a button that always fails.
  it('drops the receipt when the server says the checkout was already used', async () => {
    storeReceipt();
    mockGeneratePlaylist.mockRejectedValue({
      response: { data: { error: 'This payment has already been used.', code: 'CHECKOUT_ALREADY_USED' } },
    });

    renderPage();

    await waitFor(() => expect(receiptExists()).toBe(false));
    expect(screen.queryByRole('button', { name: /try again/i })).not.toBeInTheDocument();
  });

  it('does nothing at all when there is no receipt', async () => {
    renderPage();

    await waitFor(() => expect(mockGetVenue).toHaveBeenCalled());
    expect(mockGeneratePlaylist).not.toHaveBeenCalled();
  });

  // A venue that closed the tab mid-generation still has an unspent receipt.
  it('resumes an orphaned receipt even without the redirect query param', async () => {
    storeReceipt();
    window.history.replaceState({}, '', '/venue/playlists');
    mockGeneratePlaylist.mockResolvedValue({ data: { added: [{ id: 'a' }] } });

    render(
      <MemoryRouter initialEntries={['/venue/playlists']}>
        <VenueBrowsePlaylists />
      </MemoryRouter>
    );

    await waitFor(() => expect(mockGeneratePlaylist).toHaveBeenCalledTimes(1));
  });
});
