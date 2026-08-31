import { useMemo, useState } from 'react';
import { useAttendanceStore } from '../../../store/attendanceStore.js';
import { useAuthStore } from '../../../store/authStore.js';
import EmployeeAttendanceCard from '../../../components/ui/EmployeeAttendanceCard.jsx';
import ManualOverrideSlideOver from '../../../components/attendance/ManualOverrideSlideOver.jsx';

function formatLongDate(iso) {
  if (!iso) return '';
  return new Date(`${iso}T00:00:00`).toLocaleDateString('en-AE', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

const COUNTER_META = [
  { key: 'present', label: 'Present', tone: 'bg-emerald-50 text-emerald-700' },
  { key: 'late', label: 'Late', tone: 'bg-amber-50 text-amber-700' },
  { key: 'absent', label: 'Absent', tone: 'bg-rose-50 text-rose-700' },
  { key: 'leave', label: 'On leave', tone: 'bg-sky-50 text-sky-700' },
  { key: 'notCheckedIn', label: 'Not checked in', tone: 'bg-surface-2 text-ink-muted' },
];

export default function TodayTab() {
  const today = useAttendanceStore((s) => s.today);
  const refreshToday = useAttendanceStore((s) => s.refreshToday);
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const [overrideEmp, setOverrideEmp] = useState(null);

  const counters = today?.counters || {
    present: 0,
    late: 0,
    absent: 0,
    leave: 0,
    notCheckedIn: 0,
  };
  const employees = today?.employees || [];

  const grouped = useMemo(() => {
    const order = ['present', 'late', 'absent', 'leave', 'not_checked_in'];
    return [...employees].sort((a, b) => {
      const ai = order.indexOf(a.status);
      const bi = order.indexOf(b.status);
      return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
    });
  }, [employees]);

  const canOverride = hasPermission('attendance.mark_manual');

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-wider text-ink-muted">Today</p>
          <p className="text-lg font-semibold text-ink">{formatLongDate(today?.date)}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {COUNTER_META.map((c) => (
            <div
              key={c.key}
              className={`rounded-card px-4 py-2 ${c.tone}`}
            >
              <p className="text-xs font-medium">{c.label}</p>
              <p className="text-xl font-semibold leading-tight">
                {counters[c.key] || 0}
              </p>
            </div>
          ))}
        </div>
      </div>

      {grouped.length === 0 ? (
        <div className="rounded-card border border-border bg-surface p-8 text-center text-sm text-ink-muted">
          No active employees.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {grouped.map((emp) => (
            <EmployeeAttendanceCard
              key={emp.employeeId}
              employee={emp}
              canOverride={canOverride}
              onOverride={setOverrideEmp}
            />
          ))}
        </div>
      )}

      <ManualOverrideSlideOver
        open={Boolean(overrideEmp)}
        onClose={() => setOverrideEmp(null)}
        employee={overrideEmp}
        onSaved={() => {
          setOverrideEmp(null);
          refreshToday();
        }}
      />
    </div>
  );
}
