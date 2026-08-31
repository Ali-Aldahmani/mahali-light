import Avatar from './Avatar.jsx';
import Button from './Button.jsx';
import AttendanceStatusBadge from './AttendanceStatusBadge.jsx';
import WorkingHoursCounter from './WorkingHoursCounter.jsx';
import { ArrowDownToLine, ArrowUpFromLine, Settings2 } from 'lucide-react';

function formatTime(input) {
  if (!input) return '—';
  return new Date(input).toLocaleTimeString('en-AE', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
}

// Today-tab roster card. Compact enough to fit ~4 per row on a 1440px
// screen without losing the essential info (status, check-in/out time, live
// hours counter, plus a Manager-only override action).
export default function EmployeeAttendanceCard({
  employee,
  canOverride = false,
  onOverride = null,
}) {
  const {
    employeeName,
    roleTitle,
    status,
    lateMinutes,
    checkIn,
    checkOut,
    standardHours,
  } = employee;
  return (
    <div className="rounded-card border border-border bg-surface p-4 shadow-card">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <Avatar name={employeeName} size="md" />
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">{employeeName}</p>
            {roleTitle && (
              <p className="truncate text-xs text-ink-muted">{roleTitle}</p>
            )}
          </div>
        </div>
        <AttendanceStatusBadge status={status} lateMinutes={lateMinutes} size="md" />
      </div>

      <div className="mt-3 grid grid-cols-2 gap-3 text-xs">
        <div className="rounded-input bg-surface-2 p-2">
          <div className="flex items-center gap-1 text-ink-muted">
            <ArrowDownToLine className="h-3 w-3" />
            <span>Check-in</span>
          </div>
          <div className="mt-0.5 font-medium tabular-nums">
            {formatTime(checkIn)}
          </div>
        </div>
        <div className="rounded-input bg-surface-2 p-2">
          <div className="flex items-center gap-1 text-ink-muted">
            <ArrowUpFromLine className="h-3 w-3" />
            <span>Check-out</span>
          </div>
          <div className="mt-0.5 font-medium tabular-nums">
            {formatTime(checkOut)}
          </div>
        </div>
      </div>

      <div className="mt-3 flex items-center justify-between border-t border-border pt-3">
        <div className="text-xs text-ink-muted">
          {checkOut ? 'Total worked' : checkIn ? 'Live worked' : 'Working hours'}
        </div>
        <WorkingHoursCounter
          checkIn={checkIn}
          checkOut={checkOut}
          standardHours={standardHours || 8}
          className="text-sm font-semibold"
        />
      </div>

      {canOverride && (
        <div className="mt-3">
          <Button
            variant="ghost"
            size="sm"
            className="w-full"
            onClick={() => onOverride && onOverride(employee)}
          >
            <Settings2 className="mr-1.5 h-3.5 w-3.5" />
            Manual override
          </Button>
        </div>
      )}
    </div>
  );
}
