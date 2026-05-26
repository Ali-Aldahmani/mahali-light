import Badge from './Badge.jsx';

const META = {
  pending: { tone: 'warning', label: 'Pending' },
  approved: { tone: 'success', label: 'Approved' },
  rejected: { tone: 'error', label: 'Rejected' },
  cancelled: { tone: 'muted', label: 'Cancelled' },
  completed: { tone: 'success', label: 'Completed' },
};

export default function ReturnStatusBadge({ status, size = 'md', className = '' }) {
  const meta = META[(status || '').toLowerCase()] || {
    tone: 'muted',
    label: status || '—',
  };
  return (
    <Badge tone={meta.tone} size={size} dot className={className}>
      {meta.label}
    </Badge>
  );
}
