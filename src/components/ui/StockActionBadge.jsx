import Badge from './Badge.jsx';

const META = {
  returned_to_stock: { tone: 'success', label: 'Returned to stock' },
  quarantined: { tone: 'warning', label: 'Quarantined' },
  disposed: { tone: 'error', label: 'Disposed' },
};

export default function StockActionBadge({ action, size = 'md', className = '' }) {
  const meta = META[(action || '').toLowerCase()] || {
    tone: 'muted',
    label: action || '—',
  };
  return (
    <Badge tone={meta.tone} size={size} className={className}>
      {meta.label}
    </Badge>
  );
}
