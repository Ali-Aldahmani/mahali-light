import Badge from './Badge.jsx';
import { Clock, AlertCircle, CheckCircle2, CalendarClock } from 'lucide-react';

const META = {
  upcoming: { tone: 'neutral', label: 'Upcoming', Icon: CalendarClock },
  due: { tone: 'warning', label: 'Due today', Icon: Clock },
  overdue: { tone: 'error', label: 'Overdue', Icon: AlertCircle },
  paid: { tone: 'success', label: 'Paid', Icon: CheckCircle2 },
};

export default function BillPaymentStatusBadge({
  status,
  size = 'sm',
  className = '',
}) {
  const meta = META[status] || { tone: 'muted', label: status || '—' };
  const Icon = meta.Icon;
  return (
    <Badge tone={meta.tone} size={size} className={className}>
      {Icon && <Icon className="h-3 w-3" />}
      {meta.label}
    </Badge>
  );
}
