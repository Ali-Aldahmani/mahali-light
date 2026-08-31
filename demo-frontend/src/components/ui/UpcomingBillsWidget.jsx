import { useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Receipt } from 'lucide-react';
import DaysUntilDueBadge from './DaysUntilDueBadge.jsx';
import { useBillStore } from '../../store/billStore.js';

function aed(n) {
  return `AED ${Number(n || 0).toFixed(2)}`;
}

// Compact dashboard widget. Shows the top 5 most urgent bill payments plus
// the total amount due in the current month, and a CTA to the full page.
export default function UpcomingBillsWidget() {
  const upcoming = useBillStore((s) => s.upcoming);
  const refresh = useBillStore((s) => s.refreshUpcoming);

  useEffect(() => {
    if (!upcoming) refresh();
  }, [upcoming, refresh]);

  const items = useMemo(() => {
    const b = upcoming?.buckets || {};
    return [
      ...(b.overdue || []),
      ...(b.dueToday || []),
      ...(b.thisWeek || []),
      ...(b.thisMonth || []),
    ].slice(0, 5);
  }, [upcoming]);

  const totalThisMonth = upcoming?.totals?.dueThisMonthAmount || 0;

  return (
    <div className="card p-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-accent-light text-accent">
            <Receipt size={16} />
          </div>
          <h3 className="font-semibold">Upcoming bills</h3>
        </div>
        <Link to="/expenses" className="text-xs text-accent hover:underline">
          View all
        </Link>
      </div>

      {items.length === 0 ? (
        <p className="mt-4 text-sm text-ink-muted">
          No bills require attention right now.
        </p>
      ) : (
        <ul className="mt-3 space-y-2">
          {items.map((b) => (
            <li
              key={b.id}
              className="flex items-center justify-between rounded-input border border-border bg-surface px-3 py-2"
            >
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-lg" aria-hidden>
                  {b.categoryIcon || '💸'}
                </span>
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">
                    {b.billName}
                  </div>
                  <DaysUntilDueBadge days={b.daysUntilDue} />
                </div>
              </div>
              <div className="text-sm font-semibold">
                {Number(b.amountDue || 0) > 0 ? aed(b.amountDue) : 'Variable'}
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-4 flex items-center justify-between border-t border-border pt-3 text-sm">
        <span className="text-ink-muted">Total due this month</span>
        <span className="font-semibold">{aed(totalThisMonth)}</span>
      </div>
    </div>
  );
}
