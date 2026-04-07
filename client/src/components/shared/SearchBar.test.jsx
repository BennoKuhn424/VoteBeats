/**
 * Unit tests for the SearchBar component.
 *
 * api is mocked so no real HTTP requests are made.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mockSearch = vi.fn();
const mockSearchSongs = vi.fn();

vi.mock('../../utils/api', () => ({
  default: {
    search: (...args) => mockSearch(...args),
    searchSongs: (...args) => mockSearchSongs(...args),
  },
}));

import SearchBar from './SearchBar';

const SONG_ITEM = {
  songId: '111',
  trackName: 'Test Track',
  artistName: 'Test Artist',
  artwork: 'https://example.com/art.jpg',
  duration: 210,
};

let consoleErrorSpy;
beforeEach(() => {
  vi.clearAllMocks();
  // Suppress console.error from the component (expected in error-path tests)
  consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  consoleErrorSpy.mockRestore();
});

// ── Render ────────────────────────────────────────────────────────────────────
describe('SearchBar — render', () => {
  it('renders search input and button', () => {
    render(<SearchBar venueCode="V1" onRequestSong={vi.fn()} />);
    expect(screen.getByPlaceholderText(/search for a song/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /search/i })).toBeInTheDocument();
  });

  it('shows "Request" label on the result button when payment is not required', async () => {
    const user = userEvent.setup();
    mockSearch.mockResolvedValue({ data: { results: [SONG_ITEM] } });
    render(<SearchBar venueCode="V1" onRequestSong={vi.fn()} requestSettings={{ requirePaymentForRequest: false }} />);
    await user.type(screen.getByPlaceholderText(/search/i), 'test');
    await user.click(screen.getByRole('button', { name: /^search$/i }));
    await waitFor(() => expect(screen.getByText('Request')).toBeInTheDocument());
  });

  it('shows price label when payment is required', async () => {
    const user = userEvent.setup();
    mockSearch.mockResolvedValue({ data: { results: [SONG_ITEM] } });
    render(
      <SearchBar
        venueCode="V1"
        onRequestSong={vi.fn()}
        requestSettings={{ requirePaymentForRequest: true, requestPriceCents: 1500 }}
      />
    );
    await user.type(screen.getByPlaceholderText(/search/i), 'test');
    await user.click(screen.getByRole('button', { name: /^search$/i }));
    await waitFor(() => expect(screen.getByText('R15')).toBeInTheDocument());
  });
});

// ── Search behaviour ──────────────────────────────────────────────────────────
describe('SearchBar — search behaviour', () => {
  it('does not search when query is empty', async () => {
    const user = userEvent.setup();
    render(<SearchBar venueCode="V1" onRequestSong={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: /search/i }));
    expect(mockSearch).not.toHaveBeenCalled();
  });

  it('calls api.search with query and venueCode', async () => {
    const user = userEvent.setup();
    mockSearch.mockResolvedValue({ data: { results: [] } });
    render(<SearchBar venueCode="V1" onRequestSong={vi.fn()} />);
    await user.type(screen.getByPlaceholderText(/search/i), 'Blinding Lights');
    await user.click(screen.getByRole('button', { name: /search/i }));
    await waitFor(() => expect(mockSearch).toHaveBeenCalledWith('Blinding Lights', 'V1'));
  });

  it('shows "No songs found" when results are empty', async () => {
    const user = userEvent.setup();
    mockSearch.mockResolvedValue({ data: { results: [] } });
    render(<SearchBar venueCode="V1" onRequestSong={vi.fn()} />);
    await user.type(screen.getByPlaceholderText(/search/i), 'zzz');
    await user.click(screen.getByRole('button', { name: /search/i }));
    await waitFor(() => expect(screen.getByText(/no songs found/i)).toBeInTheDocument());
  });

  it('renders search results when api returns songs', async () => {
    const user = userEvent.setup();
    mockSearch.mockResolvedValue({ data: { results: [SONG_ITEM] } });
    render(<SearchBar venueCode="V1" onRequestSong={vi.fn()} />);
    await user.type(screen.getByPlaceholderText(/search/i), 'test');
    await user.click(screen.getByRole('button', { name: /search/i }));
    await waitFor(() => expect(screen.getByText('Test Track')).toBeInTheDocument());
    expect(screen.getByText('Test Artist')).toBeInTheDocument();
  });

  it('falls back to api.searchSongs when api.search throws', async () => {
    const user = userEvent.setup();
    mockSearch.mockRejectedValue(new Error('network error'));
    mockSearchSongs.mockResolvedValue({ data: [SONG_ITEM] });
    render(<SearchBar venueCode="V1" onRequestSong={vi.fn()} />);
    await user.type(screen.getByPlaceholderText(/search/i), 'test');
    await user.click(screen.getByRole('button', { name: /search/i }));
    await waitFor(() => expect(screen.getByText('Test Track')).toBeInTheDocument());
    expect(mockSearchSongs).toHaveBeenCalled();
  });

  it('shows error message when both api.search and api.searchSongs fail', async () => {
    const user = userEvent.setup();
    mockSearch.mockRejectedValue(new Error('fail'));
    mockSearchSongs.mockRejectedValue(new Error('fail too'));
    render(<SearchBar venueCode="V1" onRequestSong={vi.fn()} />);
    await user.type(screen.getByPlaceholderText(/search/i), 'test');
    await user.click(screen.getByRole('button', { name: /search/i }));
    await waitFor(() => expect(screen.getByText(/search failed/i)).toBeInTheDocument());
  });

  it('disables the search button while a request is in flight', async () => {
    const user = userEvent.setup();
    // Never resolves — keeps loading state active
    mockSearch.mockReturnValue(new Promise(() => {}));
    render(<SearchBar venueCode="V1" onRequestSong={vi.fn()} />);
    await user.type(screen.getByPlaceholderText(/search/i), 'test');
    await user.click(screen.getByRole('button', { name: /search/i }));
    expect(screen.getByRole('button', { name: /\.\.\./i })).toBeDisabled();
  });
});

// ── Request flow ──────────────────────────────────────────────────────────────
describe('SearchBar — request flow', () => {
  it('calls onRequestSong with correct song object when result is clicked', async () => {
    const user = userEvent.setup();
    const onRequestSong = vi.fn();
    mockSearch.mockResolvedValue({ data: { results: [SONG_ITEM] } });
    render(<SearchBar venueCode="V1" onRequestSong={onRequestSong} />);
    await user.type(screen.getByPlaceholderText(/search/i), 'test');
    await user.click(screen.getByRole('button', { name: /search/i }));
    await waitFor(() => screen.getByText('Test Track'));
    await user.click(screen.getByText('Test Track'));

    expect(onRequestSong).toHaveBeenCalledWith(
      expect.objectContaining({
        appleId: '111',
        title: 'Test Track',
        artist: 'Test Artist',
        duration: 210,
      }),
      null // no payment info
    );
  });

  it('passes payment info to onRequestSong when payment is required', async () => {
    const user = userEvent.setup();
    const onRequestSong = vi.fn();
    mockSearch.mockResolvedValue({ data: { results: [SONG_ITEM] } });
    render(
      <SearchBar
        venueCode="V1"
        onRequestSong={onRequestSong}
        requestSettings={{ requirePaymentForRequest: true, requestPriceCents: 2000 }}
      />
    );
    await user.type(screen.getByPlaceholderText(/search/i), 'test');
    await user.click(screen.getByRole('button', { name: /search/i }));
    await waitFor(() => screen.getByText('Test Track'));
    await user.click(screen.getByText('Test Track'));

    expect(onRequestSong).toHaveBeenCalledWith(
      expect.objectContaining({ appleId: '111' }),
      expect.objectContaining({ requiresPayment: true, priceRand: 20 })
    );
  });

  it('clears results and query after requesting a song', async () => {
    const user = userEvent.setup();
    mockSearch.mockResolvedValue({ data: { results: [SONG_ITEM] } });
    render(<SearchBar venueCode="V1" onRequestSong={vi.fn()} />);
    await user.type(screen.getByPlaceholderText(/search/i), 'test');
    await user.click(screen.getByRole('button', { name: /search/i }));
    await waitFor(() => screen.getByText('Test Track'));
    await user.click(screen.getByText('Test Track'));

    expect(screen.queryByText('Test Track')).not.toBeInTheDocument();
    expect(screen.getByPlaceholderText(/search/i)).toHaveValue('');
  });

  it('clears the error message when the user starts typing again', async () => {
    const user = userEvent.setup();
    mockSearch.mockResolvedValue({ data: { results: [] } });
    render(<SearchBar venueCode="V1" onRequestSong={vi.fn()} />);
    await user.type(screen.getByPlaceholderText(/search/i), 'nope');
    await user.click(screen.getByRole('button', { name: /search/i }));
    await waitFor(() => screen.getByText(/no songs found/i));
    await user.type(screen.getByPlaceholderText(/search/i), ' new query');
    expect(screen.queryByText(/no songs found/i)).not.toBeInTheDocument();
  });
});

// ── Legacy API format ─────────────────────────────────────────────────────────
describe('SearchBar — legacy api format', () => {
  it('handles legacy (title/artist/albumArt/appleId) format from fallback', async () => {
    const user = userEvent.setup();
    const legacyItem = {
      appleId: '999',
      title: 'Legacy Song',
      artist: 'Legacy Artist',
      albumArt: 'https://example.com/legacy.jpg',
      duration: 190,
    };
    mockSearch.mockRejectedValue(new Error('fail'));
    mockSearchSongs.mockResolvedValue({ data: [legacyItem] });
    const onRequestSong = vi.fn();
    render(<SearchBar venueCode="V1" onRequestSong={onRequestSong} />);
    await user.type(screen.getByPlaceholderText(/search/i), 'legacy');
    await user.click(screen.getByRole('button', { name: /search/i }));
    await waitFor(() => screen.getByText('Legacy Song'));
    await user.click(screen.getByText('Legacy Song'));

    expect(onRequestSong).toHaveBeenCalledWith(
      expect.objectContaining({ appleId: '999', title: 'Legacy Song' }),
      null
    );
  });
});
