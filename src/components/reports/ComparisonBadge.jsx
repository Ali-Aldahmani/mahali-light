import { TrendingDown, TrendingUp } from 'lucide-react';
import Badge from '../ui/Badge.jsx';

// Tiny visual indicator: ▲ green for positive change, ▼ red for negative.
// Used in the net profit card and KPI rows.
export default function ComparisonBadge({ change, invertColors = false, size = 'md' }) {
  if (change == null || Number.isNaN(Number(change))) {
    return (
      <Badge tone="muted" size={size}>
        —
      </Badge>
    );
  }
  const n = Number(change);
  const up = n > 0;
  const colorTone = invertColors
    ? up
      ? 'error'
      : 'success'
    : up
      ? 'success'
      : n < 0
        ? 'error'
        : 'muted';
  const Icon = up ? TrendingUp : TrendingDown;
  return (
    <Badge tone={colorTone} size={size}>
      <Icon size={12} className="-mx-0.5" />
      {`${Math.abs(n).toFixed(1)}%`}
    </Badge>
  );
}
