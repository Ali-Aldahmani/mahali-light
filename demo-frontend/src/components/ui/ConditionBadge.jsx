import Badge from './Badge.jsx';

const META = {
  good: { tone: 'success', label: 'Good' },
  defective: { tone: 'error', label: 'Defective' },
  damaged: { tone: 'warning', label: 'Damaged' },
};

export default function ConditionBadge({ condition, size = 'md', className = '' }) {
  const meta = META[(condition || '').toLowerCase()] || {
    tone: 'muted',
    label: condition || '—',
  };
  return (
    <Badge tone={meta.tone} size={size} dot className={className}>
      {meta.label}
    </Badge>
  );
}
