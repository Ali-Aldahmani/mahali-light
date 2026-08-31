import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Banknote,
  CalendarDays,
  ChartArea,
  PiggyBank,
  RefreshCw,
  TrendingDown,
  TrendingUp,
  Wallet,
} from 'lucide-react';
import PageHeader from '../components/ui/PageHeader.jsx';
import Button from '../components/ui/Button.jsx';
import Select from '../components/ui/Select.jsx';
import PermissionGate from '../components/ui/PermissionGate.jsx';
import { useAuthStore } from '../store/authStore.js';
import KPICard from '../components/analytics/KPICard.jsx';
import SalesTimelineChart from '../components/analytics/SalesTimelineChart.jsx';
import TopProductsTable from '../components/analytics/TopProductsTable.jsx';
import EmployeePerformanceTable from '../components/analytics/EmployeePerformanceTable.jsx';
import CategoryBreakdownBars from '../components/analytics/CategoryBreakdownBars.jsx';
import PeakHoursHeatmap from '../components/analytics/PeakHoursHeatmap.jsx';
import AlertsPanel from '../components/analytics/AlertsPanel.jsx';
import FinanceDashboardWidget from '../components/ui/FinanceDashboardWidget.jsx';
import {
  getKPIs,
  getSparkline,
  getDailySnapshot,
  getSalesTimeline,
  getTopProducts,
  getEmployeePerformance,
  getCategoryBreakdown,
  getPeakHeatmap,
} from '../services/analyticsService.js';

// Quick-range presets for the dashboard. We deliberately stick to four
// useful windows; the analytics hub offers the full range editor.
const RANGES = [
  { value: 'this_week', label: 'This week' },
  { value: 'this_month', label: 'This month' },
  { value: 'this_quarter', label: 'This quarter' },
  { value: 'this_year', label: 'This year' },
];

function rangeDates(key) {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  let start;
  let end;
  if (key === 'this_week') {
    const day = now.getDay();
    const diff = (day + 6) % 7; // back to Monday
    start = new Date(y, m, now.getDate() - diff);
    end = new Date(y, m, start.getDate() + 6);
  } else if (key === 'this_quarter') {
    const qStart = Math.floor(m / 3) * 3;
    start = new Date(y, qStart, 1);
    end = new Date(y, qStart + 3, 0);
  } else if (key === 'this_year') {
    start = new Date(y, 0, 1);
    end = new Date(y, 11, 31);
  } else {
    start = new Date(y, m, 1);
    end = new Date(y, m + 1, 0);
  }
  return {
    start_date: start.toISOString().slice(0, 10),
    end_date: end.toISOString().slice(0, 10),
  };
}

const REFRESH_MS_KPI = 5 * 60 * 1000;
const REFRESH_MS_CHART = 15 * 60 * 1000;

// Skeleton placeholder used while data loads. Pure visual filler.
function SkeletonCard({ height = 96 }) {
  return (
    <div
      className="rounded-card border border-border bg-surface animate-pulse"
      style={{ height }}
    />
  );
}

export default function DashboardPage() {
  const user = useAuthStore((s) => s.user);
  const permissions = useAuthStore((s) => s.permissions);
  const owned = useMemo(() => new Set(permissions || []), [permissions]);
  const canAnalytics = owned.has('analytics.view_dashboard') || owned.has('*') || true;

  const [rangeKey, setRangeKey] = useState('this_month');
  const range = useMemo(() => rangeDates(rangeKey), [rangeKey]);

  const [snapshot, setSnapshot] = useState(null);
  const [kpis, setKpis] = useState(null);
  const [revenueSparkline, setRevenueSparkline] = useState([]);
  const [timeline, setTimeline] = useState([]);
  const [topProducts, setTopProducts] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [categories, setCategories] = useState([]);
  const [heatmap, setHeatmap] = useState({ cells: [], max_count: 0 });
  const [busy, setBusy] = useState(false);

  // Load light pieces (KPI cards, sparkline) — they refresh more often.
  const loadKpiBundle = useCallback(async () => {
    if (!canAnalytics) return;
    try {
      const [k, snap, spark] = await Promise.all([
        getKPIs(range).then((r) => r?.data || r),
        getDailySnapshot().then((r) => r?.data || r),
        getSparkline('revenue', 7).then((r) => r?.data || r),
      ]);
      setKpis(k);
      setSnapshot(snap);
      setRevenueSparkline((spark || []).map((d) => ({ value: d.value, label: d.bucket })));
    } catch (_err) {
      // soft-fail — leave previous data in place
    }
  }, [canAnalytics, range]);

  const loadChartBundle = useCallback(async () => {
    if (!canAnalytics) return;
    setBusy(true);
    try {
      const [tl, tp, emp, cat, hm] = await Promise.all([
        getSalesTimeline(range).then((r) => r?.data || r).catch(() => []),
        getTopProducts({ ...range, limit: 5, sort_by: 'revenue' })
          .then((r) => r?.data || r)
          .catch(() => []),
        getEmployeePerformance(range).then((r) => r?.data || r).catch(() => []),
        getCategoryBreakdown({ ...range, limit: 6 })
          .then((r) => r?.data || r)
          .catch(() => []),
        getPeakHeatmap(range).then((r) => r?.data || r).catch(() => ({ cells: [], max_count: 0 })),
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
              <Select
                value={rangeKey}
                onChange={setRangeKey}
                options={RANGES}
                className="min-w-[160px]"
              />
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
          {/* Row 1 — KPI tiles */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
            {snapshot ? (
              <KPICard
                label="Today's revenue"
                value={snapshot.today_revenue}
                delta={snapshot.revenue_growth_pct}
                hint={`${snapshot.today_invoices} invoices today`}
                sparkline={revenueSparkline}
                Icon={Banknote}
              />
            ) : (
              <SkeletonCard />
            )}
            {kpis ? (
              <KPICard
                label="Revenue (period)"
                value={kpis.revenue}
                delta={kpis.revenue_growth_pct}
                hint={`${kpis.invoice_count || 0} invoices`}
                Icon={ChartArea}
              />
            ) : (
              <SkeletonCard />
            )}
            {kpis ? (
              <KPICard
                label="Receivables"
                value={kpis.receivables_total}
                hint="Outstanding from customers"
                Icon={Wallet}
              />
            ) : (
              <SkeletonCard />
            )}
            {kpis ? (
              <KPICard
                label="Payables"
                value={kpis.payables_total}
                hint="Outstanding to suppliers"
                Icon={CalendarDays}
                invertDelta
              />
            ) : (
              <SkeletonCard />
            )}
            {kpis ? (
              <KPICard
                label="Net profit"
                value={kpis.net_profit}
                delta={kpis.revenue_growth_pct}
                hint={`${kpis.net_margin_pct?.toFixed(1)}% margin`}
                Icon={PiggyBank}
              />
            ) : (
              <SkeletonCard />
            )}
          </div>

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
                <Link to="/analytics?tab=employees" className="text-xs text-accent">
                  View all
                </Link>
              </div>
              <EmployeePerformanceTable rows={employees.slice(0, 4)} compact />
            </div>
          </div>

          {/* Row 3 — top products / category breakdown / alerts */}
          <div className="mt-6 grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div>
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-semibold text-ink">Top products</h3>
                <Link to="/analytics?tab=products" className="text-xs text-accent">
                  View all
                </Link>
              </div>
              <TopProductsTable rows={topProducts} />
            </div>
            <div>
              <CategoryBreakdownBars rows={categories} />
            </div>
            <div>
              <AlertsPanel />
            </div>
          </div>

          {/* Row 4 — peak hours + finance snapshot */}
          <div className="mt-6 grid grid-cols-1 lg:grid-cols-2 gap-4">
            <PermissionGate permission="analytics.view_peaks">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-sm font-semibold text-ink">Peak hours</h3>
                  <Link to="/analytics?tab=peaks" className="text-xs text-accent">
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
                  <Link to="/finance" className="text-xs text-accent">
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
