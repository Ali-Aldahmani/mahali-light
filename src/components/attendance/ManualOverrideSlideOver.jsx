import { useEffect, useState } from 'react';
import SlideOver from '../ui/SlideOver.jsx';
import Button from '../ui/Button.jsx';
import Input from '../ui/Input.jsx';
import Select from '../ui/Select.jsx';
import { createManualAttendance } from '../../services/attendanceService.js';
import { toast } from '../../store/toastStore.js';

const STATUS_OPTIONS = [
  { value: 'present', label: 'Present' },
  { value: 'late', label: 'Late' },
  { value: 'absent', label: 'Absent' },
  { value: 'half_day', label: 'Half day' },
  { value: 'leave', label: 'Leave' },
];

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function combineLocal(dateStr, timeStr) {
  if (!dateStr || !timeStr) return null;
  // Build an ISO timestamp respecting the local clock.
  const [h, m] = timeStr.split(':');
  const d = new Date(`${dateStr}T00:00:00`);
  d.setHours(Number(h) || 0, Number(m) || 0, 0, 0);
  return d.toISOString();
}

export default function ManualOverrideSlideOver({ open, onClose, employee, onSaved }) {
  const [date, setDate] = useState(todayIso());
  const [checkInTime, setCheckInTime] = useState('');
  const [checkOutTime, setCheckOutTime] = useState('');
  const [status, setStatus] = useState('present');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!open) return;
    setDate(todayIso());
    setCheckInTime(
      employee?.checkIn
        ? new Date(employee.checkIn).toTimeString().slice(0, 5)
        : '',
    );
    setCheckOutTime(
      employee?.checkOut
        ? new Date(employee.checkOut).toTimeString().slice(0, 5)
        : '',
    );
    setStatus(employee?.status === 'not_checked_in' ? 'present' : employee?.status || 'present');
    setNotes('');
    setError(null);
  }, [open, employee]);

  async function submit() {
    if (!notes.trim()) {
      setError('Notes are required for manual entries.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const record = await createManualAttendance({
        employeeId: employee.employeeId,
        date,
        checkIn: combineLocal(date, checkInTime),
        checkOut: combineLocal(date, checkOutTime),
        status,
        notes,
      });
      toast.success('Attendance record saved.');
      onSaved?.(record);
      onClose();
    } catch (err) {
      setError(err.message || 'Failed to save record.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <SlideOver
      open={open}
      onClose={onClose}
      title="Manual attendance override"
      subtitle={employee?.employeeName}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={submit} loading={busy}>
            Save record
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Input
          label="Date"
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          required
        />
        <div className="grid grid-cols-2 gap-3">
          <Input
            label="Check-in"
            type="time"
            value={checkInTime}
            onChange={(e) => setCheckInTime(e.target.value)}
          />
          <Input
            label="Check-out"
            type="time"
            value={checkOutTime}
            onChange={(e) => setCheckOutTime(e.target.value)}
          />
        </div>
        <Select
          label="Status"
          value={status}
          onChange={setStatus}
          options={STATUS_OPTIONS}
          searchable={false}
          required
        />
        <div>
          <label className="mb-1.5 block text-sm font-medium text-ink">
            Notes <span className="text-error">*</span>
          </label>
          <textarea
            className="w-full rounded-input border border-border bg-surface p-3 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
            rows={3}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Why are you making this change?"
          />
        </div>
        {error && (
          <div className="rounded-input bg-error-light p-2 text-xs text-error">{error}</div>
        )}
      </div>
    </SlideOver>
  );
}
