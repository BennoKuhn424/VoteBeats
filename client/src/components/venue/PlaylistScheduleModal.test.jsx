import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PlaylistScheduleModal from './PlaylistScheduleModal';

function renderModal(props = {}) {
  const onClose = vi.fn();
  const onSave = vi.fn().mockResolvedValue(undefined);
  render(
    <PlaylistScheduleModal
      isOpen
      onClose={onClose}
      playlistId="pl_lunch"
      playlistName="Lunch Playlist"
      existingSchedule={[]}
      onSave={onSave}
      {...props}
    />,
  );
  return { onClose, onSave };
}

function slotCard(index = 0) {
  return screen.getByText(`Time slot ${index + 1}`).closest('div').parentElement;
}

describe('PlaylistScheduleModal', () => {
  it('saves selected start/end times and days for the playlist', async () => {
    const user = userEvent.setup();
    const { onSave, onClose } = renderModal();
    const card = slotCard();
    const start = within(card).getByLabelText(/start/i);
    const end = within(card).getByLabelText(/end/i);

    await user.clear(start);
    await user.type(start, '18:30');
    await user.clear(end);
    await user.type(end, '23:45');
    await user.click(within(card).getByRole('button', { name: 'Tue' }));
    await user.click(within(card).getByRole('button', { name: 'Thu' }));
    await user.click(screen.getByRole('button', { name: /save schedule/i }));

    expect(onSave).toHaveBeenCalledWith([
      {
        playlistId: 'pl_lunch',
        startHour: 18,
        startMinute: 30,
        endHour: 23,
        endMinute: 45,
        days: [1, 3, 5],
      },
    ]);
    expect(onClose).toHaveBeenCalled();
  });

  it('loads existing schedule slots and preserves every-day slots without days', async () => {
    const user = userEvent.setup();
    const { onSave } = renderModal({
      existingSchedule: [
        { playlistId: 'other', startHour: 1, endHour: 2, days: [1] },
        { playlistId: 'pl_lunch', startHour: 9, startMinute: 15, endHour: 12, endMinute: 0 },
        { playlistId: 'pl_lunch', startHour: 18, endHour: 23, days: [5, 6] },
      ],
    });

    const cards = screen.getAllByText(/time slot/i).map((heading) => heading.closest('div').parentElement);
    expect(within(cards[0]).getByLabelText(/start/i)).toHaveValue('09:15');
    expect(within(cards[0]).getByLabelText(/end/i)).toHaveValue('12:00');
    expect(within(cards[1]).getByLabelText(/start/i)).toHaveValue('18:00');
    expect(within(cards[1]).getByLabelText(/end/i)).toHaveValue('23:00');

    await user.click(screen.getByRole('button', { name: /save schedule/i }));

    expect(onSave).toHaveBeenCalledWith([
      {
        playlistId: 'pl_lunch',
        startHour: 9,
        startMinute: 15,
        endHour: 12,
        endMinute: 0,
      },
      {
        playlistId: 'pl_lunch',
        startHour: 18,
        startMinute: 0,
        endHour: 23,
        endMinute: 0,
        days: [5, 6],
      },
    ]);
  });

  it('can add a second slot and remove all scheduled times', async () => {
    const user = userEvent.setup();
    const { onSave, onClose } = renderModal();

    await user.click(screen.getByRole('button', { name: /add another time slot/i }));
    expect(screen.getByText('Time slot 2')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /remove all scheduled times/i }));

    expect(onSave).toHaveBeenCalledWith([]);
    expect(onClose).toHaveBeenCalled();
  });
});
