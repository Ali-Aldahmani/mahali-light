import { useMemo, useState } from 'react';
import { cn } from '../../utils/cn.js';
import { ChevronLeft, ChevronRight } from 'lucide-react';

const MONTH_NAMES = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December',
];

// Aggregates a list of bill_payment rows into 12 buckets and renders a
// 4x3 grid. Each cell exposes counts + total + click handler for drill-down.
export default function AnnualBillsCalendar({ payments = [], onSelectMonth }) {
  const [year, setYear] = useState(new Date().getFullYear());

  const buckets = useMemo(() => {
    const out = Array.from({ length: 12 }, () => ({
      paid: [],
      due: [],
      overdue: [],
      upcoming: [],
      total: 0,
    }));
    for (const p of payments) {
      if (!p.dueDate) continue;
      const d = new Date(`${p.dueDate}T00:00:00`);
      if (d.getFullYear() !== year) continue;
      const m = d.getMonth();
      out[m][p.status || 'upcoming']?.push(p);
      out[m].total += Number(p.amountDue || 0);
    }
    return out;
  }, [payments, year]);

  return (
    <div className="rounded-card border border-border bg-surface shadow-soft">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <h3 className="font-medium">Annual bills calendar</h3>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setYear((y) => y - 1)}
            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-ink-muted hover:bg-surface-2"
            aria-label="Previous year"
          >
            <ChevronLeft size={16} />
          </button>
          <div className="min-w-[3rem] text-center text-sm font-medium">{year}</div>
          <button
            type="button"
            onClick={() => setYear((y) => y + 1)}
            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-ink-muted hover:bg-surface-2"
            aria-label="Next year"
          >
            <ChevronRight size={16} />
          </button>
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 p-4">
        {buckets.map((b, i) => {
          const count =
            b.paid.length + b.due.length + b.overdue.length + b.upcoming.length;
          // Use the most "alert-worthy" status to drive the cell colour.
          const dominantTone =
            b.overdue.length > 0
              ? 'border-error/40 bg-error-light'
              : b.due.length > 0
              ? 'border-warning/40 bg-warning-light'
              : b.upcoming.length > 0
              ? 'border-accent/30 bg-accent-light'
              : b.paid.length > 0
              ? 'border-success/30 bg-success-light'
              : 'border-border bg-surface-2';
          return (
            <button
              key={i}
              type="button"
              onClick={() =>
                onSelectMonth?.({ year, month: i + 1, payments: [
                  ...b.overdue, ...b.due, ...b.upcoming, ...b.paid,
                ] })
              }
              className={cn(
                'rounded-card border p-3 text-left transition hover:shadow-soft',
                dominantTone,
              )}
            >
              <div className="font-medium">{MONTH_NAMES[i]}</div>
              <div className="mt-1 flex items-center justify-between text-xs">
                <span className="text-ink-muted">
                  {count} bill{count === 1 ? '' : 's'}
                </span>
                {b.total > 0 && (
                  <span className="font-semibold">
                    AED {b.total.toFixed(0)}
                  </span>
                )}
              </div>
              <div className="mt-2 flex flex-wrap gap-1">
                {b.overdue.length > 0 && (
                  <span className="rounded-full bg-error px-1.5 text-[10px] text-white">
                    {b.overdue.length} overdue
                  </span>
                )}
                {b.due.length > 0 && (
                  <span className="rounded-full bg-warning px-1.5 text-[10px] text-white">
                    {b.due.length} due
                  </span>
                )}
                {b.upcoming.length > 0 && (
                  <span className="rounded-full bg-accent px-1.5 text-[10px] text-white">
                    {b.upcoming.length} upcoming
                  </span>
                )}
                {b.paid.length > 0 && (
                  <span className="rounded-full bg-success px-1.5 text-[10px] text-white">
                    {b.paid.length} paid
                  </span>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
