import { useMemo } from 'react';
import ExpenseCategoryIcon from './ExpenseCategoryIcon.jsx';

// Inline-SVG bar chart of expenses by category for a single month. Designed
// for the One-time Expenses tab and the dashboard summary card.
export default function MonthlyExpenseSummary({
  summary,
  month,
  year,
  onChangeMonth,
}) {
  const items = summary?.byCategory || [];
  const max = useMemo(
    () => items.reduce((m, c) => Math.max(m, Number(c.total) || 0), 0),
    [items],
  );

  return (
    <div className="rounded-card border border-border bg-surface shadow-soft">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <h3 className="font-medium">Monthly expense summary</h3>
        <div className="flex items-center gap-2 text-sm">
          <select
            value={month}
            onChange={(e) => onChangeMonth?.({ month: Number(e.target.value), year })}
            className="h-8 rounded-input border border-border bg-surface px-2"
          >
            {Array.from({ length: 12 }).map((_, i) => (
              <option key={i + 1} value={i + 1}>
                {new Date(0, i).toLocaleString('default', { month: 'long' })}
              </option>
            ))}
          </select>
          <select
            value={year}
            onChange={(e) => onChangeMonth?.({ month, year: Number(e.target.value) })}
            className="h-8 rounded-input border border-border bg-surface px-2"
          >
            {Array.from({ length: 5 }).map((_, i) => {
              const y = new Date().getFullYear() - 2 + i;
              return (
                <option key={y} value={y}>
                  {y}
                </option>
              );
            })}
          </select>
        </div>
      </div>
      <div className="p-4">
        {items.length === 0 ? (
          <div className="py-8 text-center text-sm text-ink-muted">
            No expenses recorded for this month.
          </div>
        ) : (
          <ul className="space-y-2">
            {items.map((c) => {
              const pct = max > 0 ? Math.round((c.total / max) * 100) : 0;
              return (
                <li key={c.categoryId} className="space-y-1">
                  <div className="flex items-center justify-between text-sm">
                    <ExpenseCategoryIcon
                      icon={c.categoryIcon}
                      name={c.categoryName}
                    />
                    <span className="font-medium">
                      AED {Number(c.total).toFixed(2)}
                    </span>
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-surface-2">
                    <div
                      className="h-full rounded-full bg-accent"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        <div className="mt-4 flex items-center justify-between border-t border-border pt-3 text-sm">
          <span className="text-ink-muted">Total this month</span>
          <span className="text-base font-semibold">
            AED {Number(summary?.monthTotal || 0).toFixed(2)}
          </span>
        </div>
      </div>
    </div>
  );
}
