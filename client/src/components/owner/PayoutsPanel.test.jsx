import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, test, expect, vi, beforeEach } from 'vitest';
import PayoutsPanel from './PayoutsPanel';
import api from '../../utils/api';

vi.mock('../../utils/api', () => ({
  default: {
    getOutstandingPayouts: vi.fn(),
    updatePayoutStatus: vi.fn(),
    reconcilePayouts: vi.fn(),
    getOrphanedPayments: vi.fn(),
    resolveOrphanedPayment: vi.fn(),
  },
}));

const noOrphans = { data: { orphans: [], unresolvedCount: 0, unresolvedCents: 0 } };

const oneVenue = {
  data: {
    venues: [
      {
        venueCode: 'VEN001',
        venueName: 'The Bar',
        outstandingCents: 4900,
        outstandingRand: '49.00',
        unpaidMonths: 2,
        months: [
          { id: 'po_1', monthLabel: '2026-05', venueAmountCents: 3500, status: 'pending' },
          { id: 'po_2', monthLabel: '2026-06', venueAmountCents: 1400, status: 'pending' },
        ],
        bankDetails: {
          bankName: 'FNB',
          accountHolder: 'Jane Doe',
          accountNumber: '1234567890',
          branchCode: '250655',
        },
      },
    ],
    totalCents: 4900,
    totalRand: '49.00',
    venueCount: 1,
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  api.getOrphanedPayments.mockResolvedValue(noOrphans);
});

describe('PayoutsPanel', () => {
  test('lists venues owed money with aggregated totals', async () => {
    api.getOutstandingPayouts.mockResolvedValue(oneVenue);

    render(<PayoutsPanel />);

    expect(await screen.findByText('The Bar')).toBeInTheDocument();
    expect(screen.getByText('R49.00')).toBeInTheDocument();
    expect(screen.getByText(/2 months/i)).toBeInTheDocument();
  });

  test('shows bank details once a venue row is expanded', async () => {
    const user = userEvent.setup();
    api.getOutstandingPayouts.mockResolvedValue(oneVenue);

    render(<PayoutsPanel />);
    await user.click(await screen.findByText('The Bar'));

    expect(screen.getByText('FNB')).toBeInTheDocument();
    expect(screen.getByText('1234567890')).toBeInTheDocument();
  });

  test('requires a proof reference before the confirm button enables', async () => {
    const user = userEvent.setup();
    api.getOutstandingPayouts.mockResolvedValue(oneVenue);

    render(<PayoutsPanel />);
    await user.click(await screen.findByText('The Bar'));
    await user.click(screen.getAllByRole('button', { name: /mark paid/i })[0]);

    const confirm = screen.getByRole('button', { name: /confirm paid/i });
    expect(confirm).toBeDisabled();

    await user.type(screen.getByLabelText(/proof of payment/i), 'FNB-REF-1');
    expect(confirm).toBeEnabled();
  });

  test('sends the proof reference when confirming payment', async () => {
    const user = userEvent.setup();
    api.getOutstandingPayouts.mockResolvedValue(oneVenue);
    api.updatePayoutStatus.mockResolvedValue({ data: {} });

    render(<PayoutsPanel />);
    await user.click(await screen.findByText('The Bar'));
    await user.click(screen.getAllByRole('button', { name: /mark paid/i })[0]);
    await user.type(screen.getByLabelText(/proof of payment/i), 'FNB-REF-1');
    await user.click(screen.getByRole('button', { name: /confirm paid/i }));

    await waitFor(() => {
      expect(api.updatePayoutStatus).toHaveBeenCalledWith('po_1', 'paid', '', 'FNB-REF-1');
    });
  });

  test('warns when reconciliation finds a mismatch', async () => {
    const user = userEvent.setup();
    api.getOutstandingPayouts.mockResolvedValue(oneVenue);
    api.reconcilePayouts.mockResolvedValue({
      data: { monthLabel: '2026-06', checked: 3, balanced: false, mismatchCount: 1, rows: [] },
    });

    render(<PayoutsPanel />);
    await user.click(await screen.findByRole('button', { name: /reconcile/i }));

    expect(await screen.findByText(/do not pay until resolved/i)).toBeInTheDocument();
  });

  test('confirms when reconciliation balances', async () => {
    const user = userEvent.setup();
    api.getOutstandingPayouts.mockResolvedValue(oneVenue);
    api.reconcilePayouts.mockResolvedValue({
      data: { monthLabel: '2026-06', checked: 3, balanced: true, mismatchCount: 0, rows: [] },
    });

    render(<PayoutsPanel />);
    await user.click(await screen.findByRole('button', { name: /reconcile/i }));

    expect(await screen.findByText(/match the payment records/i)).toBeInTheDocument();
  });

  test('warns when a venue has no bank details on file', async () => {
    const user = userEvent.setup();
    api.getOutstandingPayouts.mockResolvedValue({
      data: {
        venues: [{ ...oneVenue.data.venues[0], bankDetails: null }],
        totalCents: 4900,
        venueCount: 1,
      },
    });

    render(<PayoutsPanel />);
    await user.click(await screen.findByText('The Bar'));

    expect(screen.getByText(/No bank details on file/i)).toBeInTheDocument();
  });

  test('alerts on payments that could not be booked automatically', async () => {
    api.getOutstandingPayouts.mockResolvedValue(oneVenue);
    api.getOrphanedPayments.mockResolvedValue({
      data: {
        orphans: [
          {
            checkoutId: 'chk_bad',
            venueCode: 'VEN001',
            amountCents: 2500,
            amountRand: '25.00',
            reason: 'amount_mismatch',
            resolved: false,
          },
        ],
        unresolvedCount: 1,
        unresolvedCents: 2500,
      },
    });

    render(<PayoutsPanel />);

    expect(await screen.findByText(/could not be booked automatically/i)).toBeInTheDocument();
    expect(screen.getByText('chk_bad')).toBeInTheDocument();
    expect(screen.getByText('amount_mismatch')).toBeInTheDocument();
  });

  test('requires a note before an orphaned payment can be resolved', async () => {
    const user = userEvent.setup();
    api.getOutstandingPayouts.mockResolvedValue(oneVenue);
    api.getOrphanedPayments.mockResolvedValue({
      data: {
        orphans: [
          { checkoutId: 'chk_bad', venueCode: 'VEN001', amountCents: 2500, amountRand: '25.00', reason: 'fulfil_failed', resolved: false },
        ],
        unresolvedCount: 1,
        unresolvedCents: 2500,
      },
    });
    api.resolveOrphanedPayment.mockResolvedValue({ data: {} });

    render(<PayoutsPanel />);
    const resolveBtn = await screen.findByRole('button', { name: /mark resolved/i });
    expect(resolveBtn).toBeDisabled();

    await user.type(screen.getByLabelText(/resolution note for chk_bad/i), 'refunded manually');
    expect(resolveBtn).toBeEnabled();

    await user.click(resolveBtn);
    await waitFor(() => {
      expect(api.resolveOrphanedPayment).toHaveBeenCalledWith('chk_bad', 'refunded manually');
    });
  });

  test('orphan lookup failure does not hide the payouts list', async () => {
    api.getOutstandingPayouts.mockResolvedValue(oneVenue);
    api.getOrphanedPayments.mockRejectedValue(new Error('boom'));

    render(<PayoutsPanel />);

    expect(await screen.findByText('The Bar')).toBeInTheDocument();
  });

  test('shows a settled state when nothing is owed', async () => {
    api.getOutstandingPayouts.mockResolvedValue({
      data: { venues: [], totalCents: 0, venueCount: 0 },
    });

    render(<PayoutsPanel />);

    expect(await screen.findByText(/every venue is settled/i)).toBeInTheDocument();
  });
});
