'use client';

import { useMemo } from 'react';
import { getTopProducts } from '@/services/analyticsService';
import { DEFAULT_DASHBOARD_RANGE, rangeDates } from '@/lib/dashboard/ranges';
import { useMobileQuery } from '@/hooks/useMobileQuery';
import MobileTopProductsTable from '../MobileTopProductsTable';
import { MobileCard, MobileEmpty, MobileError, MobileSkeleton } from '../MobileStates';

export default function MobileTopProducts() {
  const range = useMemo(() => rangeDates(DEFAULT_DASHBOARD_RANGE), []);
  const top = useMobileQuery(
    () => getTopProducts({ ...range, limit: 10, sort_by: 'revenue' }).then((r: any) => r?.data || r || []),
    [range],
  );
  const rows = (top.data as any[]) || [];

  return (
    <MobileCard className="px-2 pb-3 pt-4">
      <h1 className="mb-3 px-3 font-m-inter text-[14px] font-semibold text-ink">Top products</h1>
      {top.error ? (
        <MobileError message={top.error} onRetry={top.reload} />
      ) : top.loading ? (
        <div role="status" aria-label="Loading top products" className="space-y-2 px-1">
          {[0, 1, 2, 3].map((i) => (
            <MobileSkeleton key={i} className="h-[72px] border-0 bg-m-row" />
          ))}
        </div>
      ) : rows.length ? (
        <MobileTopProductsTable rows={rows} />
      ) : (
        <MobileEmpty title="No sales in this period." description="Top sellers this month will appear here." />
      )}
    </MobileCard>
  );
}
