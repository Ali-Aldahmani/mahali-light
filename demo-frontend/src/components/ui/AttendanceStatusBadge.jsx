import Badge from './Badge.jsx';
import { CheckCircle2, Clock, XCircle, Plane, CalendarOff, Sparkles, Hourglass } from 'lucide-react';

// Maps the attendance status string to a tone + label + icon. Statuses come
// from the backend so any unknown value renders as a neutral fallback.
const META = {
  present: { tone: 'success', label: 'Present', Icon: CheckCircle2 },
  late: { tone: 'warning', label: 'Late', Icon: Clock },
  absent: { tone: 'error', label: 'Absent', Icon: XCircle },
  leave: { tone: 'accent', label: 'On Leave', Icon: Plane },
  half_day: { tone: 'warning', label: 'Half Day', Icon: Hourglass },
  holiday: { tone: 'muted', label: 'Holiday', Icon: Sparkles },
  not_checked_in: { tone: 'muted', label: 'Not checked in', Icon: CalendarOff },
};

export default function AttendanceStatusBadge({
  status,
  lateMinutes = 0,
  size = 'sm',
  withIcon = true,
  className = '',
}) {
  const meta = META[status] || { tone: 'muted', label: status || '—' };
  const Icon = meta.Icon;
  let label = meta.label;
  if (status === 'late' && lateMinutes > 0) {
    label = `Late (${Math.round(lateMinutes)}m)`;
  }
  return (
    <Badge tone={meta.tone} size={size} className={className}>
      {withIcon && Icon && <Icon className="h-3 w-3" />}
      {label}
    </Badge>
  );
}
