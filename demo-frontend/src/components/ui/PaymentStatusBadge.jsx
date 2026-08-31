import Badge from './Badge.jsx';

const META = {
  unpaid: { tone: 'error', label: 'Unpaid' },
  partial: { tone: 'warning', label: 'Partial' },
  paid: { tone: 'success', label: 'Paid' },
};

export default function PaymentStatusBadge({ status, size = 'md' }) {
  const meta = META[status] || { tone: 'neutral', label: status || '—' };
  return (
    <Badge tone={meta.tone} size={size} dot>
      {meta.label}
    </Badge>
  );
}
