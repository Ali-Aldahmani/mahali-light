'use client';

import { useEffect, useState } from 'react';
import PeriodSelector, { getQuickRange } from '@/components/ui/PeriodSelector';
import PLStatementTable from '@/components/ui/PLStatementTable';
import Spinner from '@/components/ui/Spinner';
import EmptyState from '@/components/ui/EmptyState';
import { getProfitAndLoss } from '@/services/financeService';

export default function PLTab() {
  const [range, setRange] = useState<any>(() => getQuickRange('this_month'));
  const [compare, setCompare] = useState(false);
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!range?.startDate || !range?.endDate) return;
    let cancelled = false;
    setLoading(true);
    getProfitAndLoss({
      startDate: range.startDate,
      endDate: range.endDate,
      compare,
    })
      .then((r: any) => {
        if (!cancelled) {
          setData(r);
          setError(null);
        }
      })
      .catch((err: any) => {
        if (!cancelled) setError(err?.message || 'Failed to load P&L.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [range, compare]);

  return (
    <div className="space-y-4">
      <div className="rounded-card border border-border bg-surface p-3 flex flex-wrap items-center gap-3">
        <PeriodSelector
          startDate={range?.startDate}
          endDate={range?.endDate}
          onChange={(next: any) => setRange((prev: any) => ({ ...prev, ...next }))}
        />
        <label className="ml-auto text-sm flex items-center gap-2">
          <input
            type="checkbox"
            checked={compare}
            onChange={(e) => setCompare(e.target.checked)}
          />
          Compare vs previous period
        </label>
      </div>
      {loading && (
        <div className="flex items-center justify-center py-12">
          <Spinner />
        </div>
      )}
      {error && !loading && (
        <EmptyState title="Could not load P&L" description={error} />
      )}
      {data && !loading && <PLStatementTable data={data} />}
    </div>
  );
}
