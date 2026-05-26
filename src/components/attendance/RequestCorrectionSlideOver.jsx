import { useEffect, useState } from 'react';
import SlideOver from '../ui/SlideOver.jsx';
import Button from '../ui/Button.jsx';
import Input from '../ui/Input.jsx';
import Select from '../ui/Select.jsx';
import {
  listAttendance,
  submitCorrection,
} from '../../services/attendanceService.js';
import { toast } from '../../store/toastStore.js';

const REASONS = [
  { value: 'forgot_checkout', label: 'Forgot to check out' },
  { value: 'wrong_time', label: 'Wrong time' },
  { value: 'system_error', label: 'System error' },
  { value: 'other', label: 'Other' },
];

function lastNDaysIso(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function combineLocal(dateStr, timeStr) {
  if (!dateStr || !timeStr) return null;
  const [h, m] = timeStr.split(':');
  const d = new Date(`${dateStr}T00:00:00`);
  d.setHours(Number(h) || 0, Number(m) || 0, 0, 0);
  return d.toISOString();
}

export default function RequestCorrectionSlideOver({ open, onClose, employeeId, onSaved }) {
  const [date, setDate] = useState(todayIso());
  const [currentRecord, setCurrentRecord] = useState(null);
  const [newCheckIn, setNewCheckIn] = useState('');
  const [newCheckOut, setNewCheckOut] = useState('');
  const [reason, setReason] = useState('forgot_checkout');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!open) return;
    setDate(todayIso());
    setNewCheckIn('');
    setNewCheckOut('');
    setReason('forgot_checkout');
    setNote('');
    setError(null);
  }, [open]);

  useEffect(() => {
    if (!open || !employeeId || !date) {
      setCurrentRecord(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await listAttendance({
          employeeId,
          from: date,
          to: date,
          limit: 1,
        });
        const rec = (res?.data || [])[0] || null;
        if (!cancelled) {
          setCurrentRecord(rec);
          if (rec?.checkIn) {
            setNewCheckIn(new Date(rec.checkIn).toTimeString().slice(0, 5));
          }
          if (rec?.checkOut) {
            setNewCheckOut(new Date(rec.checkOut).toTimeString().slice(0, 5));
          }
        }
      } catch (_e) {
        // ignore
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [date, employeeId, open]);

  async function submit() {
    if (!currentRecord) {
      setError('No attendance record found for this date.');
      return;
    }
    if (note.trim().length < 5) {
      setError('Please write a note (at least 5 characters).');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await submitCorrection({
        attendanceId: currentRecord.id,
        reason,
        requestNote: note,
        newCheckIn: combineLocal(date, newCheckIn),
        newCheckOut: combineLocal(date, newCheckOut),
      });
      toast.success('Correction request submitted.');
      onSaved?.();
      onClose();
    } catch (err) {
      setError(err.message || 'Failed to submit request.');
    } finally {
      setBusy(false);
    }
  }

  function fmt(input) {
    return input ? new Date(input).toLocaleTimeString('en-AE', { hour: '2-digit', minute: '2-digit', hour12: true }) : '—';
  }

  return (
    <SlideOver
      open={open}
      onClose={onClose}
      title="Request attendance correction"
      subtitle="Only the last 30 days can be corrected."
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={submit} loading={busy}>
            Submit request
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Input
          label="Date"
          type="date"
          value={date}
          min={lastNDaysIso(30)}
          max={todayIso()}
          onChange={(e) => setDate(e.target.value)}
          required
        />
        <div className="rounded-input bg-surface-2 p-3 text-xs">
          <p className="mb-1 font-medium text-ink">Current record</p>
          {currentRecord ? (
            <div className="space-y-0.5 text-ink-muted">
              <div>
                <span className="text-ink">Check-in:</span>{' '}
                <span className="tabular-nums">{fmt(currentRecord.checkIn)}</span>
              </div>
              <div>
                <span className="text-ink">Check-out:</span>{' '}
                <span className="tabular-nums">{fmt(currentRecord.checkOut)}</span>
              </div>
              <div>
                <span className="text-ink">Status:</span> {currentRecord.status}
              </div>
            </div>
          ) : (
            <p className="text-ink-muted">No record found for this date.</p>
          )}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Input
            label="Requested check-in"
            type="time"
            value={newCheckIn}
            onChange={(e) => setNewCheckIn(e.target.value)}
          />
          <Input
            label="Requested check-out"
            type="time"
            value={newCheckOut}
            onChange={(e) => setNewCheckOut(e.target.value)}
          />
        </div>
        <Select
          label="Reason"
          value={reason}
          onChange={setReason}
          options={REASONS}
          searchable={false}
          required
        />
        <div>
          <label className="mb-1.5 block text-sm font-medium text-ink">
            Note <span className="text-error">*</span>
          </label>
          <textarea
            className="w-full rounded-input border border-border bg-surface p-3 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
            rows={3}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Explain why this correction is needed."
          />
        </div>
        {error && (
          <div className="rounded-input bg-error-light p-2 text-xs text-error">{error}</div>
        )}
      </div>
    </SlideOver>
  );
}
