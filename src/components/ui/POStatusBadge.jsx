import Badge from './Badge.jsx';

const STATUS_META = {
  draft: { tone: 'muted', label: 'Draft' },
  confirmed: { tone: 'accent', label: 'Confirmed' },
  partially_received: { tone: 'warning', label: 'Partially received' },
  received: { tone: 'success', label: 'Received' },
  cancelled: { tone: 'error', label: 'Cancelled' },
};

export default function POStatusBadge({ status, size = 'md' }) {
  const meta = STATUS_META[status] || { tone: 'neutral', label: status || '—' };
  return (
    <Badge tone={meta.tone} size={size}>
      {meta.label}
    </Badge>
  );
}
