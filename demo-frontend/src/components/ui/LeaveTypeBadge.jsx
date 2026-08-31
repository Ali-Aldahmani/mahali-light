import Badge from './Badge.jsx';
import { Sun, Stethoscope, Wallet, AlertCircle } from 'lucide-react';

const META = {
  annual: { tone: 'accent', label: 'Annual', Icon: Sun },
  sick: { tone: 'warning', label: 'Sick', Icon: Stethoscope },
  unpaid: { tone: 'muted', label: 'Unpaid', Icon: Wallet },
  emergency: { tone: 'error', label: 'Emergency', Icon: AlertCircle },
};

export default function LeaveTypeBadge({ type, size = 'sm', withIcon = true, className = '' }) {
  const meta = META[type] || { tone: 'muted', label: type || '—' };
  const Icon = meta.Icon;
  return (
    <Badge tone={meta.tone} size={size} className={className}>
      {withIcon && Icon && <Icon className="h-3 w-3" />}
      {meta.label}
    </Badge>
  );
}
