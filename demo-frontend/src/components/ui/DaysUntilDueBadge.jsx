import Badge from './Badge.jsx';

// Renders the "X days" / "Due today" / "Overdue N days" pill. The colour
// scale matches the spec: green > 7 days, orange 1-7 days, red 0 or below.
export default function DaysUntilDueBadge({ days, size = 'sm', className = '' }) {
  if (days == null || Number.isNaN(Number(days))) {
    return (
      <Badge tone="muted" size={size} className={className}>
        —
      </Badge>
    );
  }
  const n = Number(days);
  if (n < 0) {
    const abs = Math.abs(n);
    return (
      <Badge tone="error" size={size} className={className}>
        Overdue {abs} day{abs === 1 ? '' : 's'}
      </Badge>
    );
  }
  if (n === 0) {
    return (
      <Badge tone="error" size={size} className={className}>
        Due today
      </Badge>
    );
  }
  if (n <= 7) {
    return (
      <Badge tone="warning" size={size} className={className}>
        {n} day{n === 1 ? '' : 's'}
      </Badge>
    );
  }
  return (
    <Badge tone="success" size={size} className={className}>
      {n} days
    </Badge>
  );
}
