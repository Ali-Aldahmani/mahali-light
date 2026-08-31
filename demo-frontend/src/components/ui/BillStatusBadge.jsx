import Badge from './Badge.jsx';
import { Power, Pause, XCircle } from 'lucide-react';

const META = {
  active: { tone: 'success', label: 'Active', Icon: Power },
  paused: { tone: 'warning', label: 'Paused', Icon: Pause },
  cancelled: { tone: 'error', label: 'Cancelled', Icon: XCircle },
};

export default function BillStatusBadge({ status, size = 'sm', className = '' }) {
  const meta = META[status] || { tone: 'muted', label: status || '—' };
  const Icon = meta.Icon;
  return (
    <Badge tone={meta.tone} size={size} className={className}>
      {Icon && <Icon className="h-3 w-3" />}
      {meta.label}
    </Badge>
  );
}
