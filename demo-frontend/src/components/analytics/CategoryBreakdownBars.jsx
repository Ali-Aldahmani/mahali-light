import { cn } from '../../utils/cn.js';
import { formatCurrency } from '../../utils/format.js';

// Horizontal progress bars per category. Designed for the dashboard's
// centre column where we don't have room for a pie chart. The `target`
// optional second value (if a target is set) renders as a darker tick.
export default function CategoryBreakdownBars({ rows = [], emptyText = 'No category data yet.' }) {
  if (!rows.length) {
    return (
      <div className="rounded-card border border-border bg-surface p-6 text-center text-sm text-ink-muted">
        {emptyText}
      </div>
    );
  }
  const max = Math.max(...rows.map((r) => Number(r.revenue) || 0), 1);
  return (
    <div className="rounded-card border border-border bg-surface p-4">
      <div className="text-sm font-semibold text-ink mb-3">Category breakdown</div>
      <div className="space-y-3">
        {rows.map((r) => {
          const pct = (Number(r.revenue) / max) * 100;
          return (
            <div key={r.category_name}>
              <div className="flex items-center justify-between text-sm">
                <span className="text-ink truncate" title={r.category_name}>
                  {r.category_name}
                </span>
                <span className="text-ink-muted text-xs">
                  {formatCurrency(r.revenue)} ·{' '}
                  <span className="text-accent">{r.share_pct?.toFixed(1)}%</span>
                </span>
              </div>
              <div className={cn('mt-1 h-2 w-full rounded-full bg-surface-2 overflow-hidden')}>
                <div className="h-full bg-accent" style={{ width: `${pct}%` }} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
