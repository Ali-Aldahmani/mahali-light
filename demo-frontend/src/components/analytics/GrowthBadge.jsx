import { TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { cn } from '../../utils/cn.js';

// Tiny percentage delta pill — green up / red down / grey flat.
// `invertColor` flips the colour semantics for metrics where lower is better.
export default function GrowthBadge({
  value,
  invertColor = false,
  suffix = '%',
  size = 'sm',
  className = '',
}) {
  if (value == null || Number.isNaN(Number(value))) {
    return (
      <span
        className={cn(
          'inline-flex items-center gap-1 rounded-full bg-surface-2 px-2 text-ink-muted',
          size === 'sm' ? 'py-0.5 text-xs' : 'py-1 text-sm',
          className,
        )}
      >
        <Minus className="h-3 w-3" /> —
      </span>
    );
  }
  const n = Number(value);
  const up = n > 0.05;
  const down = n < -0.05;
  const good = invertColor ? down : up;
  const bad = invertColor ? up : down;
  const cls = good
    ? 'bg-success-light text-success'
    : bad
      ? 'bg-error-light text-error'
      : 'bg-surface-2 text-ink-muted';
  const Icon = up ? TrendingUp : down ? TrendingDown : Minus;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2',
        size === 'sm' ? 'py-0.5 text-xs' : 'py-1 text-sm',
        cls,
        className,
      )}
    >
      <Icon className="h-3 w-3" />
      {Math.abs(n).toFixed(1)}
      {suffix}
    </span>
  );
}
