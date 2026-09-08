'use client';

import { useEffect, useState } from 'react';
import PeriodSelector, { getQuickRange } from '@/components/ui/PeriodSelector';
import CashFlowTable from '@/components/ui/CashFlowTable';
import Spinner from '@/components/ui/Spinner';
import EmptyState from '@/components/ui/EmptyState';
import { getCashFlow } from '@/services/financeService';

export default function CashFlowTab() {
  const [range, setRange] = useState<any>(() => getQuickRange('this_month'));
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!range?.startDate || !range?.endDate) return;
    let cancelled = false;
    setLoading(true);
    getCashFlow({ startDate: range.startDate, endDate: range.endDate })
      .then((r: any) => {
        if (!cancelled) {
          setData(r);
          setError(null);
        }
      })
      .catch((err: any) => {
        if (!cancelled) setError(err?.message || 'Failed to load cash flow.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [range]);

  return (
    <div className="space-y-4">
      <div className="rounded-card border border-border bg-surface p-3">
        <PeriodSelector
          startDate={range?.startDate}
          endDate={range?.endDate}
          onChange={(next: any) => setRange((prev: any) => ({ ...prev, ...next }))}
        />
      </div>
      {loading && (
        <div className="flex items-center justify-center py-12">
          <Spinner />
        </div>
      )}
      {error && !loading && (
        <EmptyState title="Could not load cash flow" description={error} />
      )}
      {data && !loading && <CashFlowTable data={data} />}
    </div>
  );
}
