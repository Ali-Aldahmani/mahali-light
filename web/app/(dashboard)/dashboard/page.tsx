'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { RefreshCw, TrendingDown, TrendingUp } from 'lucide-react';
import { motion } from 'motion/react';
import PageHeader from '@/components/ui/PageHeader';
import Button from '@/components/ui/Button';
import PermissionGate from '@/components/ui/PermissionGate';
import { useAuthStore } from '@/store/authStore';
import DashboardSparkCards from '@/components/analytics/DashboardSparkCards';
import { motionTokens } from '@/lib/motion-tokens';
import SalesTimelineChart from '@/components/analytics/SalesTimelineChart';
import TopProductsTable from '@/components/analytics/TopProductsTable';
import EmployeePerformanceTable from '@/components/analytics/EmployeePerformanceTable';
import CategoryBreakdownBars from '@/components/analytics/CategoryBreakdownBars';
import PeakHoursHeatmap from '@/components/analytics/PeakHoursHeatmap';
import AlertsPanel from '@/components/analytics/AlertsPanel';
import FinanceDashboardWidget from '@/components/ui/FinanceDashboardWidget';
import { DASHBOARD_RANGES as RANGES, rangeDates } from '@/lib/dashboard/ranges';
import {
  getKPIs,
  getKpiSeries,
  getSparkline,
  getDailySnapshot,
  getSalesTimeline,
  getTopProducts,
  getEmployeePerformance,
  getCategoryBreakdown,
  getPeakHeatmap,
} from '@/services/analyticsService';
import Skeleton from '@/components/ui/skeleton';

const REFRESH_MS_KPI = 5 * 60 * 1000;
const REFRESH_MS_CHART = 15 * 60 * 1000;

// Skeleton placeholder used while data loads. Pure visual filler.
function SkeletonCard({ height = 96 }: { height?: number }) {
  // Roughly one placeholder line per 40px of the card it stands in for.
  const lines = Math.max(2, Math.min(6, Math.round((height - 32) / 30)));
  return (
    <div className="rounded-card border border-border bg-surface p-4 overflow-hidden" style={{ height }}>
      <Skeleton lines={lines} />
    </div>
  );
}

export default function DashboardPage() {
  const user = useAuthStore((s) => s.user);
  const permissions = useAuthStore((s) => s.permissions);
  const owned = useMemo(() => new Set(permissions || []), [permissions]);
  const canAnalytics = owned.has('analytics.view_dashboard');

  const [rangeKey, setRangeKey] = useState('this_month');
  const range = useMemo(() => rangeDates(rangeKey), [rangeKey]);

  const [snapshot, setSnapshot] = useState<any>(null);
  const [kpis, setKpis] = useState<any>(null);
  const [revenueSparkline, setRevenueSparkline] = useState<any[]>([]);
  const [series, setSeries] = useState<any>(null);
  const [timeline, setTimeline] = useState<any[]>([]);
  const [topProducts, setTopProducts] = useState<any[]>([]);
  const [employees, setEmployees] = useState<any[]>([]);
  const [categories, setCategories] = useState<any[]>([]);
  const [heatmap, setHeatmap] = useState<any>({ cells: [], max_count: 0 });
  const [busy, setBusy] = useState(false);

  // Load light pieces (KPI cards, sparkline) — they refresh more often.
  const loadKpiBundle = useCallback(async () => {
    if (!canAnalytics) return;
    try {
      const [k, snap, spark, ser] = await Promise.all([
        getKPIs(range).then((r: any) => r?.data || r),
        getDailySnapshot().then((r: any) => r?.data || r),
        getSparkline('revenue', 14).then((r: any) => r?.data || r),
        getKpiSeries(range).then((r: any) => r?.data || r).catch(() => null),
      ]);
      setKpis(k);
      setSnapshot(snap);
      setSeries(ser);
      setRevenueSparkline((spark || []).map((d: any) => ({ value: d.value, label: d.bucket })));
    } catch (_err) {
      // soft-fail — leave previous data in place
    }
  }, [canAnalytics, range]);

  const loadChartBundle = useCallback(async () => {
    if (!canAnalytics) return;
    setBusy(true);
    try {
      const [tl, tp, emp, cat, hm] = await Promise.all([
        getSalesTimeline(range).then((r: any) => r?.data || r).catch(() => []),
        getTopProducts({ ...range, limit: 5, sort_by: 'revenue' })
          .then((r: any) => r?.data || r)
          .catch(() => []),
        getEmployeePerformance(range).then((r: any) => r?.data || r).catch(() => []),
        getCategoryBreakdown({ ...range, limit: 6 })
          .then((r: any) => r?.data || r)
          .catch(() => []),
        getPeakHeatmap(range).then((r: any) => r?.data || r).catch(() => ({ cells: [], max_count: 0 })),
      ]);
      setTimeline(tl || []);
      setTopProducts(tp || []);
      setEmployees(emp || []);
      setCategories(cat || []);
      setHeatmap(hm || { cells: [], max_count: 0 });
    } finally {
      setBusy(false);
    }
  }, [canAnalytics, range]);

  useEffect(() => {
    loadKpiBundle();
    loadChartBundle();
  }, [loadKpiBundle, loadChartBundle]);

  // Light auto-refresh — KPI cards every 5min, charts every 15min.
  useEffect(() => {
    if (!canAnalytics) return undefined;
    const kpiTimer = setInterval(loadKpiBundle, REFRESH_MS_KPI);
    const chartTimer = setInterval(loadChartBundle, REFRESH_MS_CHART);
    return () => {
      clearInterval(kpiTimer);
      clearInterval(chartTimer);
    };
  }, [canAnalytics, loadKpiBundle, loadChartBundle]);

  function manualRefresh() {
    loadKpiBundle();
    loadChartBundle();
  }

  return (
    <div>
      <PageHeader
        title={`Welcome back, ${user?.username || 'user'}`}
        subtitle="Live store snapshot — revenue, profit, people and demand."
        action={
          canAnalytics ? (
            <div className="flex items-center gap-2">
              <PeriodToggle value={rangeKey} onChange={setRangeKey} />
              <Button
                variant="secondary"
                onClick={manualRefresh}
                disabled={busy}
                title="Refresh dashboard"
              >
                <RefreshCw className="h-4 w-4" />
                Refresh
              </Button>
            </div>
          ) : null
        }
      />

      {!canAnalytics && (
        <div className="rounded-card border border-border bg-surface p-6 text-center text-sm text-ink-muted">
          Ask an administrator to grant the <code>analytics.view_dashboard</code>{' '}
          permission to see live KPIs.
        </div>
      )}

      {canAnalytics && (
        <>
          {/* Row 1 — KPI sparkline cards */}
          {snapshot && kpis ? (
            <DashboardSparkCards
              snapshot={snapshot}
              kpis={kpis}
              series={series}
              todaySeries={revenueSparkline}
              periodLabel={RANGES.find((x) => x.value === rangeKey)?.label ?? ''}
            />
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
              {Array.from({ length: 5 }, (_, i) => (
                <SkeletonCard key={i} height={168} />
              ))}
            </div>
          )}

          {/* Row 2 — sales chart + employee leaderboard */}
          <div className="mt-6 grid grid-cols-1 lg:grid-cols-5 gap-4">
            <div className="lg:col-span-3">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-semibold text-ink">Revenue over time</h3>
                <span className="text-xs text-ink-muted">
                  This period vs previous · {kpis?.revenue_growth_pct >= 0 ? (
                    <span className="text-success inline-flex items-center gap-1">
                      <TrendingUp className="h-3 w-3" />
                      {Math.abs(kpis?.revenue_growth_pct || 0).toFixed(1)}%
                    </span>
                  ) : (
                    <span className="text-error inline-flex items-center gap-1">
                      <TrendingDown className="h-3 w-3" />
                      {Math.abs(kpis?.revenue_growth_pct || 0).toFixed(1)}%
                    </span>
                  )}
                </span>
              </div>
              <SalesTimelineChart rows={timeline} />
            </div>
            <div className="lg:col-span-2">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-semibold text-ink">Top employees</h3>
                <Link href="/analytics?tab=employees" className="text-xs text-accent">
                  View all
                </Link>
              </div>
              <EmployeePerformanceTable rows={employees.slice(0, 4)} compact />
            </div>
          </div>

          {/* Row 3 — top products / category breakdown / alerts. Each column
              stretches to the tallest sibling so uneven content (e.g. one
              product vs. several categories) doesn't leave one card
              visually shorter than the others. */}
          <div className="mt-6 grid grid-cols-1 lg:grid-cols-3 gap-4 items-stretch">
            <div className="flex flex-col h-full">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-semibold text-ink">Top products</h3>
                <Link href="/analytics?tab=products" className="text-xs text-accent">
                  View all
                </Link>
              </div>
              <TopProductsTable rows={topProducts} className="flex-1" />
            </div>
            <CategoryBreakdownBars rows={categories} className="h-full" />
            <AlertsPanel className="h-full" />
          </div>

          {/* Row 4 — peak hours + finance snapshot */}
          <div className="mt-6 grid grid-cols-1 lg:grid-cols-2 gap-4">
            <PermissionGate permission="analytics.view_peaks">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-sm font-semibold text-ink">Peak hours</h3>
                  <Link href="/analytics?tab=peaks" className="text-xs text-accent">
                    Explore
                  </Link>
                </div>
                <PeakHoursHeatmap
                  cells={heatmap.cells}
                  maxCount={heatmap.max_count}
                  compact
                />
              </div>
            </PermissionGate>
            <PermissionGate permission="finance.view_dashboard">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-sm font-semibold text-ink">Financial snapshot</h3>
                  <Link href="/finance" className="text-xs text-accent">
                    Open finance
                  </Link>
                </div>
                <FinanceDashboardWidget />
              </div>
            </PermissionGate>
          </div>
        </>
      )}
    </div>
  );
}

/** This Month / Last Month switch for the whole dashboard. */
function PeriodToggle({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div role="radiogroup" aria-label="Dashboard period" className="inline-flex h-10 items-center gap-0.5 rounded-input border border-border bg-surface p-1">
      {RANGES.map((r) => {
        const on = r.value === value;
        return (
          <button
            key={r.value}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(r.value)}
            className={`relative h-8 rounded-[6px] px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${on ? 'text-white' : 'text-ink-muted hover:text-ink'}`}
          >
            {on && (
              <motion.span
                layoutId="dashboard-period"
                className="absolute inset-0 rounded-[6px] bg-accent shadow-sm"
                transition={motionTokens.spring.snappy}
              />
            )}
            <span className="relative">{r.label}</span>
          </button>
        );
      })}
    </div>
  );
}
