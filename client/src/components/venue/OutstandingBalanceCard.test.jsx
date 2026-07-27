import { render, screen, waitFor } from '@testing-library/react';
import { describe, test, expect, vi, beforeEach } from 'vitest';
import OutstandingBalanceCard from './OutstandingBalanceCard';
import api from '../../utils/api';

vi.mock('../../utils/api', () => ({
  default: { getVenueOutstanding: vi.fn() },
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe('OutstandingBalanceCard', () => {
  test('shows the total owed across several unpaid months', async () => {
    api.getVenueOutstanding.mockResolvedValue({
      data: {
        outstandingCents: 11900,
        outstandingRand: '119.00',
        unpaidMonths: 3,
        months: [
          { id: 'p1', monthLabel: '2026-04', venueAmountCents: 7000, status: 'pending' },
          { id: 'p2', monthLabel: '2026-05', venueAmountCents: 3500, status: 'pending' },
          { id: 'p3', monthLabel: '2026-06', venueAmountCents: 1400, status: 'pending' },
        ],
        thisMonth: { venueAmountCents: 0, monthLabel: '2026-07' },
      },
    });

    render(<OutstandingBalanceCard venueCode="VEN001" />);

    expect(await screen.findByText('R119.00')).toBeInTheDocument();
    expect(screen.getByText(/3 months awaiting transfer/i)).toBeInTheDocument();
    expect(screen.getByText('2026-04')).toBeInTheDocument();
    expect(screen.getByText('R70.00')).toBeInTheDocument();
  });

  test('flags a failed payout as still owed', async () => {
    api.getVenueOutstanding.mockResolvedValue({
      data: {
        outstandingCents: 3500,
        unpaidMonths: 1,
        months: [{ id: 'p1', monthLabel: '2026-05', venueAmountCents: 3500, status: 'failed' }],
        thisMonth: { venueAmountCents: 0, monthLabel: '2026-07' },
      },
    });

    render(<OutstandingBalanceCard venueCode="VEN001" />);

    // R35.00 appears twice — as the headline total and in the month breakdown.
    await waitFor(() => {
      expect(screen.getAllByText('R35.00').length).toBeGreaterThan(0);
    });
    expect(screen.getByText(/retry pending/i)).toBeInTheDocument();
  });

  test('shows settled state when nothing is owed', async () => {
    api.getVenueOutstanding.mockResolvedValue({
      data: {
        outstandingCents: 0,
        unpaidMonths: 0,
        months: [],
        thisMonth: { venueAmountCents: 0, monthLabel: '2026-07' },
      },
    });

    render(<OutstandingBalanceCard venueCode="VEN001" />);

    expect(await screen.findByText(/All settled/i)).toBeInTheDocument();
  });

  test('separates this-month earnings from the outstanding balance', async () => {
    api.getVenueOutstanding.mockResolvedValue({
      data: {
        outstandingCents: 3500,
        unpaidMonths: 1,
        months: [{ id: 'p1', monthLabel: '2026-06', venueAmountCents: 3500, status: 'pending' }],
        thisMonth: { venueAmountCents: 1400, monthLabel: '2026-07' },
      },
    });

    render(<OutstandingBalanceCard venueCode="VEN001" />);

    // Owed figure is the headline; this month's takings are a separate note.
    await waitFor(() => {
      expect(screen.getAllByText('R35.00').length).toBeGreaterThan(0);
    });
    expect(screen.getByText(/earned in/i)).toBeInTheDocument();
    expect(screen.getByText(/2026-07/)).toBeInTheDocument();
  });

  test('offers a retry when the request fails', async () => {
    api.getVenueOutstanding.mockRejectedValue(new Error('network'));

    render(<OutstandingBalanceCard venueCode="VEN001" />);

    await waitFor(() => {
      expect(screen.getByText(/Could not load balance/i)).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
  });
});
