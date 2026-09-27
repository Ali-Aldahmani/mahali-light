'use client';

import { useMemo, useState } from 'react';
import { getUpcomingBills, listBills } from '@/services/billService';
import { useMobileQuery } from '@/hooks/useMobileQuery';
import { cn } from '@/lib/utils/cn';
import MobileSortHeader, { nextSort, sortRows, type SortState } from '../MobileSortHeader';
import { MobileCard, MobileEmpty, MobileError, MobileSkeleton } from '../MobileStates';

// Same fixed two-decimal format as the desktop Bills tab and the Figma frame.
function aed(n: unknown) {
  return `AED ${Number(n || 0).toFixed(2)}`;
}

function SummaryCard({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <MobileCard className="min-h-[100px] p-4 font-m-inter">
      <p className="text-[12px] uppercase leading-4 tracking-[0.6px] text-ink-muted">{label}</p>
      <p className="mt-1 truncate text-[20px] font-semibold leading-7 text-ink">{value}</p>
      {hint && <p className="mt-0.5 text-[12px] leading-4 text-ink-muted">{hint}</p>}
    </MobileCard>
  );
}

function DuePill({ days }: { days: number | null | undefined }) {
  if (typeof days !== 'number') return null;
  if (days < 0) {
    return (
      <span className="mt-1 inline-flex h-5 w-fit items-center gap-1.5 rounded-full bg-error-light px-2 text-[11px] font-medium text-error">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/mobile/overdue.svg" alt="" aria-hidden className="h-3 w-3" />
        Overdue
      </span>
    );
  }
  if (days === 0) {
    return (
      <span className="mt-1 inline-flex h-5 w-fit items-center rounded-full bg-warning-light px-2 text-[11px] font-medium text-warning">
        Due today
      </span>
    );
  }
  return null;
}

type BillSortKey = 'name' | 'amount' | 'nextDueDate';
const GRID = 'grid grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_minmax(0,1fr)] items-center gap-x-2 px-3';

export default function MobileExpenses() {
  const summary = useMobileQuery(() => getUpcomingBills(), []);
  const bills = useMobileQuery(
    () => listBills({ status: 'active' }).then((r: any) => r?.data || []),
    [],
  );
  const [sort, setSort] = useState<SortState<BillSortKey>>(null);

  const up: any = summary.data;
  const totals = up?.totals;
  const buckets = up?.buckets || {};
  const rows = useMemo(
    () => sortRows((bills.data as any[]) || [], sort, (b: any, k) => (k === 'amount' ? Number(b.amount || 0) : b[k])),
    [bills.data, sort],
  );
  const onSort = (k: BillSortKey) => setSort((s) => nextSort(s, k));

  return (
    <div className="space-y-6">
      <h1 className="sr-only">Expenses</h1>
      {summary.error ? (
        <MobileError message={summary.error} onRetry={summary.reload} />
      ) : summary.loading || !up ? (
        <div role="status" aria-label="Loading bill summary" className="grid grid-cols-2 gap-3">
          {[0, 1, 2, 3].map((i) => (
            <MobileSkeleton key={i} className="h-[100px]" />
          ))}
        </div>
      ) : (
        <section aria-label="Bills summary" className="grid grid-cols-2 gap-3">
          <SummaryCard label="Monthly bills" value={aed(totals?.monthlyRecurringTotal)} hint="Active monthly recurring" />
          <SummaryCard
            label="Overdue"
            value={aed(totals?.overdueAmount)}
            hint={`${buckets.overdue?.length || 0} payment(s)`}
          />
          <SummaryCard
            label="Due this week"
            value={aed(totals?.dueThisWeekAmount)}
            hint={`${(buckets.dueToday?.length || 0) + (buckets.thisWeek?.length || 0)} payment(s)`}
          />
          <SummaryCard label="Paid this month" value={aed(totals?.paidThisMonth)} />
        </section>
      )}

      {bills.error ? (
        <MobileError message={bills.error} onRetry={bills.reload} />
      ) : bills.loading ? (
        <div role="status" aria-label="Loading bills" className="space-y-2">
          {[0, 1, 2].map((i) => (
            <MobileSkeleton key={i} className="h-[85px]" />
          ))}
        </div>
      ) : !rows.length ? (
        <MobileEmpty title="No active bills" description="Recurring bills added on desktop will appear here." />
      ) : (
        <MobileCard className="overflow-hidden shadow-card font-m-inter">
          <div role="table" aria-label="Bills">
            <div role="row" className={cn(GRID, 'bg-surface-2')}>
              <MobileSortHeader label="Bill" sortKey="name" sort={sort} onSort={onSort} />
              <MobileSortHeader label="Expected" sortKey="amount" sort={sort} onSort={onSort} align="right" />
              <MobileSortHeader label="Next due" sortKey="nextDueDate" sort={sort} onSort={onSort} />
            </div>
            {rows.map((b: any, i: number) => (
              <div
                role="row"
                key={b.id}
                className={cn(GRID, 'min-h-[85px] border-t border-border py-3', i % 2 === 1 && 'bg-bg/40')}
              >
                <span role="cell" className="flex min-w-0 items-center gap-2">
                  <span aria-hidden className="text-[16px] leading-4">
                    {b.categoryIcon || '📄'}
                  </span>
                  <span className="line-clamp-2 break-words text-[14px] font-medium text-ink">{b.name}</span>
                </span>
                <span role="cell" className="text-right text-[14px] text-ink">
                  {b.isVariableAmount ? <span className="text-[12px] text-ink-muted">Variable</span> : aed(b.amount)}
                </span>
                <span role="cell" className="flex min-w-0 flex-col">
                  <span className="text-[14px] text-ink">{b.nextDueDate || '—'}</span>
                  <DuePill days={b.daysUntilDue} />
                </span>
              </div>
            ))}
          </div>
        </MobileCard>
      )}
    </div>
  );
}
