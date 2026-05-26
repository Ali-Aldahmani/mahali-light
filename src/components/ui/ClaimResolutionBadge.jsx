import Badge from './Badge.jsx';

const META = {
  replaced: { tone: 'accent', label: 'Replaced' },
  repaired: { tone: 'success', label: 'Repaired' },
  rejected: { tone: 'error', label: 'Rejected' },
};

// Status badge for warranty_claims.resolution. Returns null when the claim
// hasn't been resolved yet so the caller can render its own placeholder.
export default function ClaimResolutionBadge({
  resolution,
  size = 'md',
  className = '',
}) {
  if (!resolution) return null;
  const meta = META[resolution] || { tone: 'neutral', label: resolution };
  return (
    <Badge tone={meta.tone} size={size} className={className}>
      {meta.label}
    </Badge>
  );
}

const STATUS_META = {
  open: { tone: 'warning', label: 'Open' },
  in_progress: { tone: 'accent', label: 'In progress' },
  resolved: { tone: 'success', label: 'Resolved' },
  rejected: { tone: 'error', label: 'Rejected' },
};

export function ClaimStatusBadge({ status, size = 'md', className = '' }) {
  const meta = STATUS_META[status] || { tone: 'neutral', label: status };
  return (
    <Badge tone={meta.tone} size={size} dot className={className}>
      {meta.label}
    </Badge>
  );
}
