import { useState, useEffect } from 'react';
import { X, Clock, Plus, Trash2 } from 'lucide-react';

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
/** JS getDay(): Sun=0 … Sat=6 — UI order Mon–Sun */
const LABEL_TO_DAY = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 0 };
const DAY_TO_LABEL = { 0: 'Sun', 1: 'Mon', 2: 'Tue', 3: 'Wed', 4: 'Thu', 5: 'Fri', 6: 'Sat' };

function pad2(n) {
  return String(n).padStart(2, '0');
}

function slotToUi(s, index) {
  return {
    id: `slot-${index}-${s.startHour}-${s.endHour}`,
    startTime: `${pad2(s.startHour)}:${pad2(s.startMinute ?? 0)}`,
    endTime: `${pad2(s.endHour)}:${pad2(s.endMinute ?? 0)}`,
    days: (s.days || []).map((d) => DAY_TO_LABEL[d]).filter(Boolean),
  };
}

function uiToServerSlot(playlistId, ui) {
  const [sh, sm] = ui.startTime.split(':').map(Number);
  const [eh, em] = ui.endTime.split(':').map(Number);
  const days = ui.days.map((L) => LABEL_TO_DAY[L]).filter((n) => n !== undefined);
  return {
    playlistId,
    startHour: Math.min(23, Math.max(0, sh || 0)),
    startMinute: Math.min(59, Math.max(0, sm || 0)),
    endHour: Math.min(23, Math.max(0, eh || 0)),
    endMinute: Math.min(59, Math.max(0, em || 0)),
    ...(days.length > 0 ? { days } : {}),
  };
}

/**
 * @param {object} props
 * @param {boolean} props.isOpen
 * @param {() => void} props.onClose
 * @param {string} props.playlistId
 * @param {string} props.playlistName
 * @param {object[]} props.existingSchedule full venue playlistSchedule
 * @param {(slots: object[]) => void} props.onSave server-shaped slots for THIS playlist only (caller merges)
 */
export default function PlaylistScheduleModal({
  isOpen,
  onClose,
  playlistId,
  playlistName,
  existingSchedule,
  onSave,
}) {
  const [timeSlots, setTimeSlots] = useState([]);

  useEffect(() => {
    if (!isOpen || !playlistId) return;
    const mine = (existingSchedule || []).filter((s) => s.playlistId === playlistId);
    if (mine.length === 0) {
      setTimeSlots([
        {
          id: 'default',
          startTime: '09:00',
          endTime: '17:00',
          days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
        },
      ]);
    } else {
      setTimeSlots(mine.map((s, i) => slotToUi(s, i)));
    }
  }, [isOpen, playlistId, existingSchedule]);

  if (!isOpen) return null;

  const addTimeSlot = () => {
    setTimeSlots([
      ...timeSlots,
      {
        id: Date.now().toString(),
        startTime: '12:00',
        endTime: '18:00',
        days: [],
      },
    ]);
  };

  const removeTimeSlot = (id) => {
    if (timeSlots.length <= 1) return;
    setTimeSlots(timeSlots.filter((slot) => slot.id !== id));
  };

  const updateTimeSlot = (id, field, value) => {
    setTimeSlots(timeSlots.map((slot) => (slot.id === id ? { ...slot, [field]: value } : slot)));
  };

  const toggleDay = (slotId, day) => {
    const slot = timeSlots.find((s) => s.id === slotId);
    if (!slot) return;
    const newDays = slot.days.includes(day) ? slot.days.filter((d) => d !== day) : [...slot.days, day];
    updateTimeSlot(slotId, 'days', newDays);
  };

  const handleSave = () => {
    const serverSlots = timeSlots.map((ui) => uiToServerSlot(playlistId, ui));
    onSave(serverSlots);
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[100] p-4">
      <div className="bg-white rounded-xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-white border-b border-zinc-200 px-6 py-4 flex items-center justify-between z-10">
          <div className="flex items-center gap-3 min-w-0">
            <Clock className="w-5 h-5 text-brand-500 shrink-0" />
            <div className="min-w-0">
              <h2 className="text-zinc-900 text-lg font-semibold truncate">Schedule playlist</h2>
              <p className="text-zinc-500 text-sm truncate">{playlistName}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 hover:bg-zinc-100 rounded-lg transition-colors shrink-0"
            aria-label="Close"
          >
            <X className="w-5 h-5 text-zinc-600" />
          </button>
        </div>

        <div className="p-6">
          <p className="text-zinc-600 mb-4 text-sm">
            When the clock is inside a slot, autoplay picks <strong>random</strong> songs from this playlist. Customer
            requests still work as usual.
          </p>

          <div className="space-y-4 mb-6">
            {timeSlots.map((slot, index) => (
              <div key={slot.id} className="bg-zinc-50 rounded-lg p-4 border border-zinc-200">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-zinc-900 font-medium text-sm">Time slot {index + 1}</h3>
                  {timeSlots.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeTimeSlot(slot.id)}
                      className="p-1.5 hover:bg-zinc-200 rounded transition-colors"
                      aria-label="Remove time slot"
                    >
                      <Trash2 className="w-4 h-4 text-red-600" />
                    </button>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-3 mb-4">
                  <div>
                    <label className="block text-xs text-zinc-600 mb-1">Start</label>
                    <input
                      type="time"
                      value={slot.startTime}
                      onChange={(e) => updateTimeSlot(slot.id, 'startTime', e.target.value)}
                      className="w-full px-3 py-2 border border-zinc-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-zinc-600 mb-1">End</label>
                    <input
                      type="time"
                      value={slot.endTime}
                      onChange={(e) => updateTimeSlot(slot.id, 'endTime', e.target.value)}
                      className="w-full px-3 py-2 border border-zinc-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs text-zinc-600 mb-2">Days (empty = every day)</label>
                  <div className="flex flex-wrap gap-2">
                    {DAY_LABELS.map((day) => (
                      <button
                        key={day}
                        type="button"
                        onClick={() => toggleDay(slot.id, day)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all min-h-[36px] ${
                          slot.days.includes(day)
                            ? 'bg-brand-500 text-white'
                            : 'bg-white border border-zinc-300 text-zinc-700 hover:border-brand-500'
                        }`}
                      >
                        {day}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </div>

          <button
            type="button"
            onClick={addTimeSlot}
            className="w-full py-3 px-4 border-2 border-dashed border-zinc-300 rounded-lg text-zinc-600 hover:border-brand-500 hover:text-brand-600 transition-all flex items-center justify-center gap-2 min-h-[44px]"
          >
            <Plus className="w-4 h-4" />
            Add another time slot
          </button>

          <button
            type="button"
            onClick={() => {
              onSave([]);
              onClose();
            }}
            className="w-full mt-4 text-sm text-red-600 hover:text-red-700 font-medium py-2"
          >
            Remove all scheduled times for this playlist
          </button>
        </div>

        <div className="sticky bottom-0 bg-white border-t border-zinc-200 px-6 py-4 flex gap-3">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 px-4 py-3 border border-zinc-300 rounded-lg text-zinc-700 hover:bg-zinc-50 transition-colors min-h-[44px]"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            className="flex-1 px-4 py-3 bg-brand-500 hover:bg-brand-600 text-white rounded-lg transition-colors min-h-[44px] font-semibold"
          >
            Save schedule
          </button>
        </div>
      </div>
    </div>
  );
}
