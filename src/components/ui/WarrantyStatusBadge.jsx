import Badge from './Badge.jsx';

const META = {
  active: { tone: 'success', label: 'Active' },
  expired: { tone: 'error', label: 'Expired' },
  claimed: { tone: 'neutral', label: 'Claimed' },
  void: { tone: 'muted', label: 'Void' },
};

// `expiringSoon` is informational — overrides the visual tone but not the
// underlying status. Active + expiringSoon renders the orange/warning tone.
export default function WarrantyStatusBadge({
  status = 'active',
  expiringSoon = false,
  size = 'md',
  className = '',
}) {
  const key = (status || 'active').toLowerCase();
  let { tone, label } = META[key] || META.active;
  if (key === 'active' && expiringSoon) {
    tone = 'warning';
    label = 'Expiring soon';
  }
  return (
    <Badge tone={tone} size={size} dot className={className}>
      {label}
    </Badge>
  );
}
