import { useEffect, useState } from 'react';
import SlideOver from '../ui/SlideOver';
import Button from '../ui/Button';
import Select from '../ui/Select';
import LeaveBalanceBar from '../ui/LeaveBalanceBar';
import { calculateLeaveDays, submitLeave } from '@/services/leaveService';
import { getEmployeeBalances } from '@/services/leaveBalanceService';
import { toast } from '@/store/toastStore';
import { storeDate } from '@/lib/utils/format';
import DateRangeField from '@/components/ui/DateRangeField';

const LEAVE_TYPES = [
  { value: 'annual', label: 'Annual' },
  { value: 'sick', label: 'Sick' },
  { value: 'unpaid', label: 'Unpaid' },
  { value: 'emergency', label: 'Emergency' },
];

function todayIso() {
  return storeDate();
}

// Leave is booked ahead, so the shortcuts look forward.
const addDays = (date: Date, days: number) => new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
const LEAVE_PRESETS = [
  { label: 'Today', range: (today: Date) => ({ start: today, end: today }) },
  { label: 'Tomorrow', range: (today: Date) => ({ start: addDays(today, 1), end: addDays(today, 1) }) },
  { label: 'Next 3 days', range: (today: Date) => ({ start: addDays(today, 1), end: addDays(today, 3) }) },
  { label: 'Next 7 days', range: (today: Date) => ({ start: addDays(today, 1), end: addDays(today, 7) }) },
  { label: 'Next 14 days', range: (today: Date) => ({ start: addDays(today, 1), end: addDays(today, 14) }) },
];

export default function RequestLeaveSlideOver({
  open,
  onClose,
  employeeId,
  employees = [],
  onSaved,
}) {
  const [selectedEmployee, setSelectedEmployee] = useState(employeeId || null);
  const [leaveType, setLeaveType] = useState('annual');
  const [startDate, setStartDate] = useState(todayIso());
  const [endDate, setEndDate] = useState(todayIso());
  const [reason, setReason] = useState('');
  const [workingDays, setWorkingDays] = useState(0);
  const [balances, setBalances] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!open) return;
    setLeaveType('annual');
    setStartDate(todayIso());
    setEndDate(todayIso());
    setReason('');
    setError(null);
    setSelectedEmployee(employeeId || (employees[0]?.id ?? null));
  }, [open, employeeId, employees]);

  useEffect(() => {
    if (!open || !selectedEmployee) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await getEmployeeBalances(selectedEmployee);
        if (!cancelled) setBalances(res?.balances || []);
      } catch (_e) {
        setBalances([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, selectedEmployee]);

  useEffect(() => {
    if (!open || !startDate || !endDate) return;
    if (new Date(endDate) < new Date(startDate)) {
      setWorkingDays(0);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await calculateLeaveDays({ startDate, endDate });
        if (!cancelled) setWorkingDays(Number(res?.workingDays || 0));
      } catch (_e) {
        // ignore
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, startDate, endDate]);

  const currentBalance = balances?.find((b) => b.leaveType === leaveType);
  const showBalance = leaveType === 'annual' || leaveType === 'sick';

  async function submit() {
    setError(null);
    if (!selectedEmployee) {
      setError('Please select an employee.');
      return;
    }
    if (reason.trim().length < 5) {
      setError('Reason is required (at least 5 characters).');
      return;
    }
    if (workingDays <= 0) {
      setError('No working days in the selected range.');
      return;
    }
    setBusy(true);
    try {
      await submitLeave({
        employeeId: selectedEmployee,
        leaveType,
        startDate,
        endDate,
        reason,
      });
      toast.success('Leave request submitted.');
      onSaved?.();
      onClose();
    } catch (err) {
      setError(err.message || 'Failed to submit leave.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <SlideOver
      open={open}
      onClose={onClose}
      title="Request leave"
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
        {!employeeId && employees.length > 0 && (
          <Select
            label="Employee"
            value={selectedEmployee}
            onChange={setSelectedEmployee}
            options={employees.map((e) => ({ value: e.id, label: e.name }))}
            required
          />
        )}
        <Select
          label="Leave type"
          value={leaveType}
          onChange={setLeaveType}
          options={LEAVE_TYPES}
          searchable={false}
          required
        />
        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-ink">
            Leave dates<span className="ml-0.5 text-error">*</span>
          </span>
          <DateRangeField
            label="Leave dates"
            placeholder="Choose start and end"
            clearable={false}
            presets={LEAVE_PRESETS}
            months={1}
            from={startDate}
            to={endDate}
            onChange={({ from, to }) => {
              setStartDate(from);
              setEndDate(to);
            }}
          />
        </div>
        <div className="grid grid-cols-2 gap-3 rounded-input bg-surface-2 p-3 text-xs">
          <div>
            <p className="text-ink-muted">Working days</p>
            <p className="text-base font-semibold">{workingDays}</p>
          </div>
          {showBalance && currentBalance && (
            <div>
              <p className="text-ink-muted">Remaining ({leaveType})</p>
              <p className="text-base font-semibold">
                {currentBalance.remainingDays} day{currentBalance.remainingDays === 1 ? '' : 's'}
              </p>
            </div>
          )}
        </div>
        {showBalance && currentBalance && (
          <LeaveBalanceBar
            used={currentBalance.usedDays}
            total={currentBalance.entitledDays}
            carriedOver={currentBalance.carriedOverDays}
          />
        )}
        <div>
          <label className="mb-1.5 block text-sm font-medium text-ink">
            Reason <span className="text-error">*</span>
          </label>
          <textarea
            className="w-full rounded-input border border-border bg-surface p-3 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Explain the reason for this leave."
          />
        </div>
        {error && (
          <div className="rounded-input bg-error-light p-2 text-xs text-error">{error}</div>
        )}
      </div>
    </SlideOver>
  );
}
