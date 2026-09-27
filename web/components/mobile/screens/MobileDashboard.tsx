'use client';

import Link from 'next/link';
import { useMemo } from 'react';
import { useAuthStore } from '@/store/authStore';
import { getKPIs, getTopProducts } from '@/services/analyticsService';
import { getDrawerState } from '@/services/cashDrawerService';
import { DEFAULT_DASHBOARD_RANGE, rangeDates } from '@/lib/dashboard/ranges';
import { hasAnyPermission } from '@/lib/mobile/routePolicy';
import { formatAed, formatAmount } from '@/lib/mobile/format';
import { useMobileQuery } from '@/hooks/useMobileQuery';
import MobileTopProductsTable from '../MobileTopProductsTable';
import {
  MobileCard,
  MobileEmpty,
  MobileError,
  MobilePermissionNote,
  MobileSkeleton,
} from '../MobileStates';

function KpiCard({
  label,
  value,
  hint,
  icon,
  trendPct,
}: {
  label: string;
  value: unknown;
  hint?: string;
  icon: string;
  trendPct?: number | null;
}) {
  const trend = typeof trendPct === 'number' && Number.isFinite(trendPct) ? trendPct : null;
  return (
    <MobileCard className="flex min-h-[130px] flex-col p-4 font-m-inter">
      <div className="flex items-start justify-between gap-2">
        <p className="text-[12px] uppercase leading-4 tracking-[0.3px] text-ink-muted">{label}</p>
        <span className="flex h-9 w-9 shrink-0 items-center justify-center -mr-1 -mt-1">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={icon} alt="" aria-hidden className="h-4 w-4" />
        </span>
      </div>
      <p className="-mt-2 flex items-center gap-1 text-[24px] font-semibold leading-8 text-ink">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/mobile/dirham.svg" alt="AED" className="h-[17px] w-[17px]" />
        <span className="truncate">{formatAmount(value)}</span>
      </p>
      {hint && <p className="text-[12px] leading-4 text-ink-muted">{hint}</p>}
      {trend !== null && (
        <span
          className={
            trend >= 0
              ? 'mt-2 inline-flex h-5 w-fit items-center gap-1 rounded-full bg-success-light px-2 text-[12px] font-medium text-success'
              : 'mt-2 inline-flex h-5 w-fit items-center gap-1 rounded-full bg-error-light px-2 text-[12px] font-medium text-error'
          }
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/mobile/trend-up.svg" alt="" aria-hidden className={trend >= 0 ? 'h-3 w-3' : 'h-3 w-3 rotate-90'} />
          {Math.abs(trend).toFixed(1)}%
        </span>
      )}
    </MobileCard>
  );
}

function DrawerPill() {
  const { data } = useMobileQuery(() => getDrawerState(), []);
  if (!data) return null;
  const closed = data.status !== 'open';
  return (
    <span
      aria-label={`Cash drawer ${closed ? 'closed' : 'open'}: ${formatAed(data.currentBalance)}`}
      className="inline-flex h-[30px] shrink-0 items-center gap-2 rounded-full border border-success/30 bg-success/15 px-3 font-m-inter text-[12px] font-medium text-success"
    >
      {closed && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src="/mobile/drawer-lock.svg" alt="" aria-hidden className="h-[14px] w-[10px]" />
      )}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/mobile/drawer-cash.svg" alt="" aria-hidden className="h-[14px] w-[10px]" />
      <span className="ml-1">{formatAed(data.currentBalance)}</span>
    </span>
  );
}

export default function MobileDashboard() {
  const user = useAuthStore((s) => s.user);
  const permissions = useAuthStore((s) => s.permissions);
  const canKpis = hasAnyPermission(permissions, ['analytics.view_dashboard']);
  const canTop = hasAnyPermission(permissions, ['analytics.view']);
  const canDrawer = hasAnyPermission(permissions, ['cash.view']);
  const range = useMemo(() => rangeDates(DEFAULT_DASHBOARD_RANGE), []);

  const kpis = useMobileQuery(() => getKPIs(range), [range], { enabled: canKpis });
  const top = useMobileQuery(
    () => getTopProducts({ ...range, limit: 3, sort_by: 'revenue' }).then((r: any) => r?.data || r || []),
    [range],
    { enabled: canTop },
  );
  const k: any = kpis.data;

  return (
    <div className="space-y-5">
      <header className="flex items-center justify-between gap-3">
        <h1 className="min-w-0 truncate font-m-inter text-[24px] font-semibold leading-8 tracking-[-0.6px] text-ink">
          Welcome back, {user?.username || 'there'}
        </h1>
        {canDrawer && <DrawerPill />}
      </header>

      {!canKpis ? (
        <MobilePermissionNote />
      ) : kpis.error ? (
        <MobileError message={kpis.error} onRetry={kpis.reload} />
      ) : kpis.loading || !k ? (
        <div role="status" aria-label="Loading metrics" className="grid grid-cols-2 gap-3">
          {[0, 1, 2, 3].map((i) => (
            <MobileSkeleton key={i} className="h-[130px]" />
          ))}
        </div>
      ) : (
        <section aria-label="Key metrics" className="grid grid-cols-2 gap-3">
          <KpiCard
            label="Net profit"
            value={k.net_profit}
            hint={typeof k.net_margin_pct === 'number' ? `${k.net_margin_pct.toFixed(1)}% margin` : undefined}
            icon="/mobile/kpi-profit.svg"
          />
          <KpiCard
            label="Revenue (period)"
            value={k.revenue}
            hint={`${k.invoice_count || 0} invoices`}
            icon="/mobile/kpi-revenue.svg"
            trendPct={k.revenue_growth_pct}
          />
          <KpiCard
            label="Receivables"
            value={k.receivables_total}
            hint="Outstanding from customers"
            icon="/mobile/kpi-receivables.svg"
          />
          <KpiCard
            label="Payables"
            value={k.payables_total}
            hint="Outstanding to suppliers"
            icon="/mobile/kpi-payables.svg"
          />
        </section>
      )}

      <MobileCard className="px-2 pb-3 pt-4">
        <div className="mb-3 flex items-center justify-between px-3">
          <h2 className="font-m-inter text-[14px] font-semibold text-ink">Top products</h2>
          {canTop && (
            <Link
              href="/m/top-products"
              className="-my-3 -mr-3 flex min-h-[44px] items-center px-3 font-m-inter text-[12px] text-m-accent active:opacity-60"
            >
              View all
            </Link>
          )}
        </div>
        {!canTop ? (
          <MobilePermissionNote className="border-0 bg-m-row" />
        ) : top.error ? (
          <MobileError message={top.error} onRetry={top.reload} />
        ) : top.loading ? (
          <div role="status" aria-label="Loading top products" className="space-y-2 px-1">
            {[0, 1, 2].map((i) => (
              <MobileSkeleton key={i} className="h-[72px] border-0 bg-m-row" />
            ))}
          </div>
        ) : (top.data as any[])?.length ? (
          <MobileTopProductsTable rows={top.data as any[]} />
        ) : (
          <MobileEmpty title="No sales in this period." />
        )}
      </MobileCard>
    </div>
  );
}
