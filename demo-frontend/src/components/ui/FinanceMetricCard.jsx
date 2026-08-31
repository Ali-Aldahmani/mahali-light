import { TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { cn } from '../../utils/cn.js';
import { formatCurrency } from '../../utils/format.js';

// Single-metric tile used on the finance dashboard. Optionally renders a
// "vs previous period" delta. Direction colour is overridden by `invertColor`
// for metrics where lower is better (e.g. expenses).
export default function FinanceMetricCard({
  label,
  value,
  delta = null,
  invertColor = false,
  hint = null,
  Icon = null,
  className = '',
}) {
  const direction = delta == null ? null : delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat';
  const isPositive = direction === 'up';
  const isNegative = direction === 'down';
  const goodDir = invertColor ? isNegative : isPositive;
  const badDir = invertColor ? isPositive : isNegative;
  const deltaCls = goodDir
    ? 'bg-success-light text-success'
    : badDir
      ? 'bg-error-light text-error'
      : 'bg-surface-2 text-ink-muted';
  const TrendIcon = isPositive ? TrendingUp : isNegative ? TrendingDown : Minus;

  return (
    <div className={cn('rounded-card border border-border bg-surface p-4', className)}>
      <div className="flex items-start justify-between">
        <div className="min-w-0">
          <div className="text-xs text-ink-muted">{label}</div>
          <div className="text-2xl font-semibold text-ink mt-1 truncate">
            {typeof value === 'number' ? formatCurrency(value) : value}
          </div>
          {hint && <div className="text-xs text-ink-muted mt-1">{hint}</div>}
        </div>
        {Icon && (
          <div className="h-9 w-9 rounded-md bg-accent-light inline-flex items-center justify-center text-accent">
            <Icon className="h-4 w-4" />
          </div>
        )}
      </div>
      {delta != null && (
        <div
          className={cn(
            'mt-3 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs',
            deltaCls,
          )}
        >
          <TrendIcon className="h-3 w-3" />
          {Math.abs(delta).toFixed(1)}%
        </div>
      )}
    </div>
  );
}
