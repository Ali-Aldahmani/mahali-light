import Badge from './Badge.jsx';

const STATUS_META = {
  draft: { tone: 'muted', label: 'Draft' },
  confirmed: { tone: 'accent', label: 'Confirmed' },
  cancelled: { tone: 'error', label: 'Cancelled' },
  refunded: { tone: 'warning', label: 'Refunded' },
};

export default function InvoiceStatusBadge({ status, size = 'md' }) {
  const meta = STATUS_META[status] || { tone: 'neutral', label: status || '—' };
  return (
    <Badge tone={meta.tone} size={size}>
      {meta.label}
    </Badge>
  );
}
