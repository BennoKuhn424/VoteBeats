/**
 * Unit + integration tests for CustomerVoting.
 *
 * Socket.IO client and the API module are mocked so nothing hits the network.
 * These tests are the primary regression guard for the connection-state bugs
 * that caused the persistent "Connection lost. Reconnecting…" banner.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

// ── Mocks ─────────────────────────────────────────────────────────────────────

// Mock socket singleton — gives tests full control over connection events.
const mockSocketHandlers = {};
const mockSocket = {
  connected: false,
  connect: vi.fn(() => { mockSocket.connected = true; }),
  disconnect: vi.fn(() => { mockSocket.connected = false; }),
  emit: vi.fn(),
  on: vi.fn((event, fn) => { mockSocketHandlers[event] = fn; }),
  off: vi.fn((event) => { delete mockSocketHandlers[event]; }),
};

vi.mock('../utils/socket', () => ({ default: mockSocket }));

// Mock api module
const mockGetQueue = vi.fn();
const mockRequestSong = vi.fn();
const mockGetLyrics = vi.fn();

vi.mock('../utils/api', () => ({
  default: {
    getQueue: (...args) => mockGetQueue(...args),
    requestSong: (...args) => mockRequestSong(...args),
    getLyrics: (...args) => mockGetLyrics(...args),
    search: vi.fn().mockResolvedValue({ data: { results: [] } }),
  },
}));

// Mock child components that aren't under test here
vi.mock('../components/customer/NowPlaying', () => ({
  default: ({ song }) => <div data-testid="now-playing">{song?.title}</div>,
}));
vi.mock('../components/customer/UpcomingQueue', () => ({
  default: ({ songs }) => <div data-testid="upcoming">{songs?.length} upcoming</div>,
}));
vi.mock('../components/customer/LyricsView', () => ({
  default: () => <div data-testid="lyrics-view" />,
}));
vi.mock('../components/customer/VolumeSuggestion', () => ({
  default: () => <div data-testid="volume-suggestion" />,
}));
vi.mock('../components/shared/Logo', () => ({
  default: () => <div data-testid="logo" />,
}));
vi.mock('../hooks/useVisibilityAwarePolling', () => ({
  useVisibilityAwarePolling: vi.fn(),
}));

import CustomerVoting from './CustomerVoting';

// ── Test helpers ──────────────────────────────────────────────────────────────
const VENUE_CODE = 'TESTVN';

const EMPTY_QUEUE_RESPONSE = {
  nowPlaying: null,
  upcoming: [],
  myVotes: {},
  requestSettings: { requirePaymentForRequest: false, requestPriceCents: 1000 },
};

const QUEUE_WITH_SONG = {
  nowPlaying: { id: 's1', appleId: '111', title: 'Playing Song', artist: 'Artist', duration: 210 },
  upcoming: [{ id: 's2', appleId: '222', title: 'Up Next', artist: 'Artist2', duration: 180 }],
  myVotes: {},
  requestSettings: { requirePaymentForRequest: false, requestPriceCents: 1000 },
};

function renderCustomerVoting(venueCode = VENUE_CODE) {
  return render(
    <MemoryRouter initialEntries={[`/v/${venueCode}`]}>
      <Routes>
        <Route path="/v/:venueCode" element={<CustomerVoting />} />
      </Routes>
    </MemoryRouter>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockSocket.connected = false;
  mockSocket.connect.mockImplementation(() => { mockSocket.connected = true; });
  mockGetLyrics.mockResolvedValue({ data: { syncedLyrics: null, plainLyrics: null } });
  // Clear captured handlers
  Object.keys(mockSocketHandlers).forEach((k) => delete mockSocketHandlers[k]);
});

afterEach(() => {
  vi.clearAllTimers();
});

// ══════════════════════════════════════════════════════════════════════════════
// Initial load
// ══════════════════════════════════════════════════════════════════════════════
describe('CustomerVoting — initial load', () => {
  it('shows loading spinner before first fetch resolves', async () => {
    // Delay the API response so the spinner is visible
    mockGetQueue.mockReturnValue(new Promise(() => {})); // never resolves
    renderCustomerVoting();
    expect(screen.getByText(/connecting to venue/i)).toBeInTheDocument();
  });

  it('renders queue after successful fetch', async () => {
    mockGetQueue.mockResolvedValue({ data: QUEUE_WITH_SONG });
    renderCustomerVoting();
    await waitFor(() => expect(screen.getByTestId('now-playing')).toBeInTheDocument());
    expect(screen.getByText('Playing Song')).toBeInTheDocument();
  });

  it('connects the socket on mount', async () => {
    mockGetQueue.mockResolvedValue({ data: EMPTY_QUEUE_RESPONSE });
    renderCustomerVoting();
    await waitFor(() => expect(mockSocket.connect).toHaveBeenCalled());
  });

  it('emits join with venue code when socket connects', async () => {
    mockGetQueue.mockResolvedValue({ data: EMPTY_QUEUE_RESPONSE });
    renderCustomerVoting();
    // Simulate the socket connect event
    await act(async () => { mockSocketHandlers['connect']?.(); });
    expect(mockSocket.emit).toHaveBeenCalledWith('join', VENUE_CODE);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Regression: socket effect must NOT re-register on fetchQueue change
// ══════════════════════════════════════════════════════════════════════════════
describe('CustomerVoting — socket stability regression', () => {
  it('does not disconnect when fetchQueue ref updates (deviceId load)', async () => {
    mockGetQueue.mockResolvedValue({ data: EMPTY_QUEUE_RESPONSE });
    renderCustomerVoting();
    await waitFor(() => expect(mockSocket.connect).toHaveBeenCalledTimes(1));

    // Simulate a second render cycle (e.g. deviceId arrives from localStorage)
    // If the socket effect depended on fetchQueue, disconnect() would be called here
    await act(async () => {
      mockGetQueue.mockResolvedValue({ data: QUEUE_WITH_SONG });
    });

    // disconnect should only be called once — during unmount, not during re-render
    expect(mockSocket.disconnect).not.toHaveBeenCalled();
  });

  it('registers exactly one disconnect listener', async () => {
    mockGetQueue.mockResolvedValue({ data: EMPTY_QUEUE_RESPONSE });
    renderCustomerVoting();
    await waitFor(() => expect(mockSocket.on).toHaveBeenCalled());

    const disconnectCalls = mockSocket.on.mock.calls.filter(([event]) => event === 'disconnect');
    expect(disconnectCalls).toHaveLength(1);
  });

  it('disconnects the socket on unmount', async () => {
    mockGetQueue.mockResolvedValue({ data: EMPTY_QUEUE_RESPONSE });
    const { unmount } = renderCustomerVoting();
    await waitFor(() => expect(mockSocket.connect).toHaveBeenCalled());
    unmount();
    expect(mockSocket.disconnect).toHaveBeenCalledTimes(1);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Regression: connection banner logic
// ══════════════════════════════════════════════════════════════════════════════
describe('CustomerVoting — connection banner', () => {
  it('does NOT show banner on first load even while socket is connecting', async () => {
    // Socket starts disconnected; first queue fetch succeeds
    mockGetQueue.mockResolvedValue({ data: EMPTY_QUEUE_RESPONSE });
    renderCustomerVoting();
    await waitFor(() => expect(screen.queryByText(/connecting to venue/i)).not.toBeInTheDocument());
    // hasConnectedOnce is false so the socket-based banner should not show
    expect(screen.queryByText(/connection lost/i)).not.toBeInTheDocument();
  });

  it('does NOT show banner after a single HTTP fetch failure (transient blip)', async () => {
    mockGetQueue
      .mockResolvedValueOnce({ data: EMPTY_QUEUE_RESPONSE }) // initial: succeeds → clears loading
      .mockRejectedValueOnce(new Error('network error'));     // second poll: 1 failure

    const { useVisibilityAwarePolling } = await import('../hooks/useVisibilityAwarePolling');
    let capturedCallback;
    useVisibilityAwarePolling.mockImplementation((cb) => { capturedCallback = cb; });

    renderCustomerVoting();
    await waitFor(() => expect(screen.queryByText(/connecting to venue/i)).not.toBeInTheDocument());

    // Trigger one poll failure
    await act(async () => { await capturedCallback?.(); });

    expect(screen.queryByText(/connection lost/i)).not.toBeInTheDocument();
  });

  it('shows banner after TWO consecutive HTTP failures', async () => {
    mockGetQueue
      .mockResolvedValueOnce({ data: EMPTY_QUEUE_RESPONSE }) // initial: ok
      .mockRejectedValue(new Error('network error'));         // all subsequent: fail

    const { useVisibilityAwarePolling } = await import('../hooks/useVisibilityAwarePolling');
    let capturedCallback;
    useVisibilityAwarePolling.mockImplementation((cb) => { capturedCallback = cb; });

    renderCustomerVoting();
    await waitFor(() => expect(screen.queryByText(/connecting to venue/i)).not.toBeInTheDocument());

    // Two consecutive failures
    await act(async () => { await capturedCallback?.(); });
    await act(async () => { await capturedCallback?.(); });

    expect(screen.getByText(/connection lost/i)).toBeInTheDocument();
  });

  it('clears the banner when socket reconnects', async () => {
    mockGetQueue
      .mockResolvedValueOnce({ data: EMPTY_QUEUE_RESPONSE })
      .mockRejectedValue(new Error('network error'));

    const { useVisibilityAwarePolling } = await import('../hooks/useVisibilityAwarePolling');
    let capturedCallback;
    useVisibilityAwarePolling.mockImplementation((cb) => { capturedCallback = cb; });

    renderCustomerVoting();
    await waitFor(() => expect(screen.queryByText(/connecting to venue/i)).not.toBeInTheDocument());

    // Force the banner to appear
    await act(async () => { await capturedCallback?.(); });
    await act(async () => { await capturedCallback?.(); });
    expect(screen.getByText(/connection lost/i)).toBeInTheDocument();

    // Socket reconnects — banner must disappear immediately
    mockGetQueue.mockResolvedValue({ data: EMPTY_QUEUE_RESPONSE });
    await act(async () => { mockSocketHandlers['connect']?.(); });

    await waitFor(() => expect(screen.queryByText(/connection lost/i)).not.toBeInTheDocument());
  });

  it('shows "Venue not found" for 404 responses', async () => {
    const err = { response: { status: 404 } };
    mockGetQueue.mockRejectedValue(err);
    renderCustomerVoting();
    await waitFor(() => expect(screen.getByText(/venue not found/i)).toBeInTheDocument());
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Real-time socket updates
// ══════════════════════════════════════════════════════════════════════════════
describe('CustomerVoting — real-time socket updates', () => {
  it('updates the queue when queue:updated is received', async () => {
    mockGetQueue.mockResolvedValue({ data: EMPTY_QUEUE_RESPONSE });
    renderCustomerVoting();
    await waitFor(() => expect(screen.getByTestId('upcoming')).toBeInTheDocument());
    expect(screen.getByText('0 upcoming')).toBeInTheDocument();

    await act(async () => {
      mockSocketHandlers['queue:updated']?.({
        ...QUEUE_WITH_SONG,
        requestSettings: EMPTY_QUEUE_RESPONSE.requestSettings,
      });
    });

    expect(screen.getByText('1 upcoming')).toBeInTheDocument();
  });

  it('calls join on reconnect so the server puts client back in the venue room', async () => {
    mockGetQueue.mockResolvedValue({ data: EMPTY_QUEUE_RESPONSE });
    renderCustomerVoting();

    // First connect
    await act(async () => { mockSocketHandlers['connect']?.(); });
    mockSocket.emit.mockClear();

    // Simulate disconnect then reconnect
    await act(async () => { mockSocketHandlers['disconnect']?.(); });
    await act(async () => { mockSocketHandlers['connect']?.(); });

    expect(mockSocket.emit).toHaveBeenCalledWith('join', VENUE_CODE);
  });
});
