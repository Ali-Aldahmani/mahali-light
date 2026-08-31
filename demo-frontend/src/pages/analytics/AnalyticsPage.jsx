import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  TrendingUp,
  Package,
  Truck,
  Users,
  UsersRound,
  Activity,
  CalendarRange,
  RefreshCw,
  Download,
} from 'lucide-react';
import PageHeader from '../../components/ui/PageHeader.jsx';
import Tabs from '../../components/ui/Tabs.jsx';
import Button from '../../components/ui/Button.jsx';
import Select from '../../components/ui/Select.jsx';
import PermissionGate from '../../components/ui/PermissionGate.jsx';
import PeriodSelector from '../../components/ui/PeriodSelector.jsx';
import { useAuthStore } from '../../store/authStore.js';
import { toast } from '../../store/toastStore.js';
import KPICard from '../../components/analytics/KPICard.jsx';
import NetProfitTrendChart from '../../components/analytics/NetProfitTrendChart.jsx';
import TopProductsTable from '../../components/analytics/TopProductsTable.jsx';
import SupplierReliabilityChart from '../../components/analytics/SupplierReliabilityChart.jsx';
import CustomerLeaderboard from '../../components/analytics/CustomerLeaderboard.jsx';
import EmployeePerformanceTable from '../../components/analytics/EmployeePerformanceTable.jsx';
import PeakHoursHeatmap from '../../components/analytics/PeakHoursHeatmap.jsx';
import SeasonalityChart from '../../components/analytics/SeasonalityChart.jsx';
import ReorderTable from '../../components/analytics/ReorderTable.jsx';
import AnnualPlanTable from '../../components/analytics/AnnualPlanTable.jsx';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  Cell,
} from 'recharts';
import {
  getKPIs,
  getNetProfitTrends,
  getTopProducts,
  getWorstProducts,
  getTopSuppliers,
  getWorstSuppliers,
  getTopCustomers,
  getAtRiskCustomers,
  getEmployeePerformance,
  getPeakHours,
  getPeakDays,
  getPeakHeatmap,
  getPeakMonths,
  getProductSeasonality,
  listReorderRecommendations,
  listAnnualPlan,
  recalculateForecasts,
  downloadAnnualPlanExcel,
  dismissReorderRecommendation,
} from '../../services/analyticsService.js';
import { searchProducts } from '../../services/productService.js';
import { formatCurrency } from '../../utils/format.js';

const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function defaultRange() {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  return {
    start_date: start.toISOString().slice(0, 10),
    end_date: end.toISOString().slice(0, 10),
  };
}

// =======================================================================
// Tab: Overview
// =======================================================================
function OverviewTab({ range }) {
  const [kpis, setKpis] = useState(null);
  const [trends, setTrends] = useState([]);
  const [groupBy, setGroupBy] = useState('month');

  useEffect(() => {
    getKPIs(range).then((r) => setKpis(r?.data || r)).catch(() => {});
  }, [range]);

  useEffect(() => {
    getNetProfitTrends({ ...range, group_by: groupBy })
      .then((r) => setTrends(r?.data || r))
      .catch(() => setTrends([]));
  }, [range, groupBy]);

  if (!kpis) {
    return <div className="rounded-card border border-border bg-surface p-6 text-sm text-ink-muted">Loading metrics…</div>;
  }
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KPICard
          label="Revenue growth (MoM)"
          value={kpis.revenue_growth_pct}
          format="percent"
          delta={kpis.revenue_growth_pct}
        />
        <KPICard
          label="Gross margin"
          value={kpis.gross_margin_pct}
          format="percent"
        />
        <KPICard
          label="Net margin"
          value={kpis.net_margin_pct}
          format="percent"
        />
        <KPICard
          label="Inventory turnover"
          value={kpis.inventory_turnover}
          format="ratio"
          hint={formatCurrency(kpis.inventory_value)}
        />
        <KPICard
          label="Average order value"
          value={kpis.avg_order_value}
          delta={kpis.avg_order_growth_pct}
        />
        <KPICard
          label="Return rate"
          value={kpis.return_rate_pct}
          format="percent"
          invertDelta
        />
        <KPICard
          label="Collection rate"
          value={kpis.collection_rate_pct}
          format="percent"
        />
        <KPICard
          label="Expense ratio"
          value={kpis.expense_ratio_pct}
          format="percent"
          invertDelta
        />
      </div>

      <div>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-semibold text-ink">Net profit trend</h3>
          <Select
            value={groupBy}
            onChange={setGroupBy}
            options={[
              { value: 'day', label: 'By day' },
              { value: 'week', label: 'By week' },
              { value: 'month', label: 'By month' },
              { value: 'year', label: 'By year' },
            ]}
            className="min-w-[140px]"
          />
        </div>
        <NetProfitTrendChart rows={trends} />
      </div>
    </div>
  );
}

// =======================================================================
// Tab: Products
// =======================================================================
function ProductsTab({ range }) {
  const [sortBy, setSortBy] = useState('revenue');
  const [top, setTop] = useState([]);
  const [worst, setWorst] = useState([]);
  const [productQuery, setProductQuery] = useState('');
  const [productOptions, setProductOptions] = useState([]);
  const [selectedProductId, setSelectedProductId] = useState(null);
  const [seasonality, setSeasonality] = useState(null);
  const owned = useAuthStore((s) => s.permissions) || [];
  const canSeasonality = owned.includes('analytics.view_seasonality');

  useEffect(() => {
    Promise.all([
      getTopProducts({ ...range, limit: 10, sort_by: sortBy }),
      getWorstProducts({ ...range, limit: 10, sort_by: sortBy }),
    ])
      .then(([t, w]) => {
        setTop(t?.data || t || []);
        setWorst(w?.data || w || []);
      })
      .catch(() => {});
  }, [range, sortBy]);

  useEffect(() => {
    if (!productQuery) {
      setProductOptions([]);
      return;
    }
    let cancelled = false;
    searchProducts(productQuery, 20)
      .then((res) => {
        const items = res?.data || res || [];
        if (cancelled) return;
        setProductOptions(
          items.map((p) => ({ value: p.id, label: p.name, description: p.sku || '' })),
        );
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [productQuery]);

  useEffect(() => {
    if (!selectedProductId || !canSeasonality) {
      setSeasonality(null);
      return;
    }
    getProductSeasonality(selectedProductId, { years: 2 })
      .then((r) => setSeasonality(r?.data || r))
      .catch(() => setSeasonality(null));
  }, [selectedProductId, canSeasonality]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-ink">Best products</h3>
        <Select
          value={sortBy}
          onChange={setSortBy}
          options={[
            { value: 'revenue', label: 'Sort by Revenue' },
            { value: 'profit', label: 'Sort by Profit' },
            { value: 'quantity', label: 'Sort by Quantity' },
            { value: 'margin', label: 'Sort by Margin' },
          ]}
          className="min-w-[200px]"
        />
      </div>
      <TopProductsTable rows={top} verbose showCategory />

      <h3 className="text-sm font-semibold text-ink">Worst products</h3>
      <TopProductsTable
        rows={worst}
        verbose
        showCategory
        emptyText="No underperforming products in this window."
      />

      {canSeasonality && (
        <div>
          <h3 className="text-sm font-semibold text-ink mb-2">Product seasonality</h3>
          <div className="rounded-card border border-border bg-surface p-4">
            <Select
              value={selectedProductId}
              onChange={(value, option) => {
                setSelectedProductId(value);
                setProductQuery(option?.label || '');
              }}
              options={productOptions}
              searchable
              placeholder="Type to search for a product…"
            />
          </div>
          {seasonality && (
            <div className="mt-4">
              <SeasonalityChart
                series={seasonality.series}
                monthlyAvg={seasonality.monthly_avg}
              />
              {seasonality.peak_months?.length > 0 && (
                <div className="mt-2 text-xs text-ink-muted">
                  Peak months:{' '}
                  <strong className="text-accent">
                    {seasonality.peak_months.map((m) => MONTH[m - 1]).join(', ')}
                  </strong>
                  {seasonality.slow_months?.length > 0 && (
                    <>
                      {' '}· Slow months:{' '}
                      <strong className="text-ink">
                        {seasonality.slow_months.map((m) => MONTH[m - 1]).join(', ')}
                      </strong>
                    </>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// =======================================================================
// Tab: Suppliers
// =======================================================================
function SuppliersTab({ range }) {
  const [top, setTop] = useState([]);
  const [worst, setWorst] = useState([]);
  useEffect(() => {
    Promise.all([
      getTopSuppliers({ ...range, limit: 10 }),
      getWorstSuppliers({ ...range, limit: 10 }),
    ])
      .then(([t, w]) => {
        setTop(t?.data || t || []);
        setWorst(w?.data || w || []);
      })
      .catch(() => {});
  }, [range]);

  return (
    <div className="space-y-6">
      <h3 className="text-sm font-semibold text-ink">Most reliable suppliers</h3>
      <div className="rounded-card border border-border bg-surface overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-surface-2 text-ink-muted">
            <tr>
              <th className="px-3 py-2 text-left">Supplier</th>
              <th className="px-3 py-2 text-right">Orders</th>
              <th className="px-3 py-2 text-right">Spent</th>
              <th className="px-3 py-2 text-right">Defect rate</th>
              <th className="px-3 py-2 text-right">Lead time</th>
              <th className="px-3 py-2 text-right">On-time</th>
            </tr>
          </thead>
          <tbody>
            {top.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-ink-muted">
                  No supplier activity in this period.
                </td>
              </tr>
            ) : (
              top.map((r) => (
                <tr key={r.supplier_id} className="border-t border-border">
                  <td className="px-3 py-2">{r.supplier_name}</td>
                  <td className="px-3 py-2 text-right">{r.total_orders}</td>
                  <td className="px-3 py-2 text-right">{formatCurrency(r.total_spent)}</td>
                  <td className="px-3 py-2 text-right">{r.defect_rate_pct.toFixed(1)}%</td>
                  <td className="px-3 py-2 text-right">
                    {r.avg_lead_time_days != null ? `${r.avg_lead_time_days} d` : '—'}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {r.on_time_rate_pct != null ? `${r.on_time_rate_pct.toFixed(0)}%` : '—'}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <h3 className="text-sm font-semibold text-ink">Defect rate comparison</h3>
      <SupplierReliabilityChart rows={top} />

      <h3 className="text-sm font-semibold text-ink">Worst suppliers</h3>
      <div className="rounded-card border border-border bg-surface overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-surface-2 text-ink-muted">
            <tr>
              <th className="px-3 py-2 text-left">Supplier</th>
              <th className="px-3 py-2 text-right">Defect rate</th>
              <th className="px-3 py-2 text-right">Overdue invoices</th>
              <th className="px-3 py-2 text-right">Overdue amount</th>
              <th className="px-3 py-2 text-right">Lead time</th>
            </tr>
          </thead>
          <tbody>
            {worst.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-center text-ink-muted">
                  No problem suppliers detected.
                </td>
              </tr>
            ) : (
              worst.map((r) => (
                <tr key={r.supplier_id} className="border-t border-border">
                  <td className="px-3 py-2">{r.supplier_name}</td>
                  <td className="px-3 py-2 text-right text-error font-semibold">
                    {r.defect_rate_pct.toFixed(1)}%
                  </td>
                  <td className="px-3 py-2 text-right">{r.overdue_count}</td>
                  <td className="px-3 py-2 text-right">{formatCurrency(r.overdue_amount)}</td>
                  <td className="px-3 py-2 text-right">
                    {r.avg_lead_time_days != null ? `${r.avg_lead_time_days} d` : '—'}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// =======================================================================
// Tab: Customers
// =======================================================================
function CustomersTab({ range }) {
  const [top, setTop] = useState([]);
  const [risk, setRisk] = useState([]);
  useEffect(() => {
    Promise.all([
      getTopCustomers({ ...range, limit: 10 }),
      getAtRiskCustomers({ inactive_days: 60, limit: 25 }),
    ])
      .then(([t, r]) => {
        setTop(t?.data || t || []);
        setRisk(r?.data || r || []);
      })
      .catch(() => {});
  }, [range]);

  const spendChart = useMemo(
    () =>
      top.map((c) => ({
        name: c.customer_name,
        spend: Number(c.total_spent) || 0,
      })),
    [top],
  );

  return (
    <div className="space-y-6">
      <h3 className="text-sm font-semibold text-ink">Top customers</h3>
      <CustomerLeaderboard rows={top} />

      <h3 className="text-sm font-semibold text-ink">Top 10 by spend</h3>
      <div className="rounded-card border border-border bg-surface p-4">
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={spendChart} margin={{ top: 8, right: 12, left: 0, bottom: 48 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
            <XAxis dataKey="name" stroke="#6B7280" fontSize={11} angle={-30} interval={0} height={56} textAnchor="end" />
            <YAxis stroke="#6B7280" fontSize={11} tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
            <Tooltip
              formatter={(v) => formatCurrency(v)}
              contentStyle={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 8, fontSize: 12 }}
            />
            <Bar dataKey="spend" fill="#F97316" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <h3 className="text-sm font-semibold text-ink">At-risk customers</h3>
      <div className="rounded-card border border-border bg-surface overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-surface-2 text-ink-muted">
            <tr>
              <th className="px-3 py-2 text-left">Customer</th>
              <th className="px-3 py-2 text-right">Days inactive</th>
              <th className="px-3 py-2 text-right">Outstanding</th>
              <th className="px-3 py-2 text-right">Lifetime spend</th>
              <th className="px-3 py-2 text-left">Reason</th>
            </tr>
          </thead>
          <tbody>
            {risk.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-center text-ink-muted">
                  No at-risk customers right now. Nice.
                </td>
              </tr>
            ) : (
              risk.map((c) => (
                <tr key={c.customer_id} className="border-t border-border">
                  <td className="px-3 py-2">
                    <div className="font-medium text-ink">{c.customer_name}</div>
                    <div className="text-xs text-ink-muted">{c.phone || ''}</div>
                  </td>
                  <td className="px-3 py-2 text-right">
                    {c.last_purchase_days_ago != null ? `${c.last_purchase_days_ago} d` : '—'}
                  </td>
                  <td className="px-3 py-2 text-right">{formatCurrency(c.credit_balance)}</td>
                  <td className="px-3 py-2 text-right">{formatCurrency(c.lifetime_spent)}</td>
                  <td className="px-3 py-2 text-xs">
                    <span className="inline-flex items-center rounded-full bg-amber-100 text-amber-700 px-2 py-0.5">
                      {c.risk_reason?.replace(/_/g, ' ')}
                    </span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// =======================================================================
// Tab: Employees
// =======================================================================
function EmployeesTab({ range }) {
  const [rows, setRows] = useState([]);
  useEffect(() => {
    getEmployeePerformance(range)
      .then((r) => setRows(r?.data || r || []))
      .catch(() => setRows([]));
  }, [range]);

  const compareData = rows.slice(0, 8).map((r) => ({
    name: r.employee_name,
    revenue: Number(r.revenue_generated) || 0,
    invoices: r.invoices_created,
  }));

  return (
    <div className="space-y-6">
      <h3 className="text-sm font-semibold text-ink">Leaderboard</h3>
      <EmployeePerformanceTable rows={rows} />

      <h3 className="text-sm font-semibold text-ink">Performance comparison</h3>
      <div className="rounded-card border border-border bg-surface p-4">
        <ResponsiveContainer width="100%" height={320}>
          <BarChart data={compareData} margin={{ top: 8, right: 24, left: 0, bottom: 48 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
            <XAxis dataKey="name" stroke="#6B7280" fontSize={11} angle={-30} interval={0} height={56} textAnchor="end" />
            <YAxis yAxisId="rev" stroke="#6B7280" fontSize={11} tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
            <YAxis yAxisId="inv" orientation="right" stroke="#16A34A" fontSize={11} />
            <Tooltip
              formatter={(v, n) => (n === 'Revenue' ? formatCurrency(v) : v)}
              contentStyle={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 8, fontSize: 12 }}
            />
            <Bar yAxisId="rev" dataKey="revenue" fill="#F97316" name="Revenue" radius={[4, 4, 0, 0]} />
            <Bar yAxisId="inv" dataKey="invoices" fill="#16A34A" name="Invoices" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// =======================================================================
// Tab: Peaks
// =======================================================================
function PeaksTab({ range }) {
  const [heatmap, setHeatmap] = useState({ cells: [], max_count: 0 });
  const [days, setDays] = useState([]);
  const [months, setMonths] = useState(null);
  const [year, setYear] = useState(new Date().getFullYear());

  useEffect(() => {
    Promise.all([getPeakHeatmap(range), getPeakDays(range)])
      .then(([hm, d]) => {
        setHeatmap(hm?.data || hm || { cells: [], max_count: 0 });
        setDays(d?.data?.series || d?.series || []);
      })
      .catch(() => {});
  }, [range]);

  useEffect(() => {
    getPeakMonths({ year })
      .then((r) => setMonths(r?.data || r))
      .catch(() => setMonths(null));
  }, [year]);

  const dayChart = days.map((d) => ({
    label: d.label + (d.is_weekend ? ' (we)' : ''),
    invoices: d.invoice_count,
    revenue: d.revenue,
  }));

  return (
    <div className="space-y-6">
      <h3 className="text-sm font-semibold text-ink">Hour-of-day × day-of-week heatmap</h3>
      <PeakHoursHeatmap cells={heatmap.cells} maxCount={heatmap.max_count} />

      <h3 className="text-sm font-semibold text-ink">Day of week</h3>
      <div className="rounded-card border border-border bg-surface p-4">
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={dayChart}>
            <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
            <XAxis dataKey="label" stroke="#6B7280" fontSize={12} />
            <YAxis stroke="#6B7280" fontSize={12} />
            <Tooltip
              formatter={(v, n) => (n === 'Revenue' ? formatCurrency(v) : v)}
              contentStyle={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 8, fontSize: 12 }}
            />
            <Bar dataKey="invoices" name="Invoices" fill="#F97316" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-ink">Year-over-year months</h3>
        <Select
          value={year}
          onChange={setYear}
          options={Array.from({ length: 5 }, (_, i) => {
            const y = new Date().getFullYear() - i;
            return { value: y, label: String(y) };
          })}
          className="min-w-[120px]"
        />
      </div>
      <div className="rounded-card border border-border bg-surface p-4">
        {months ? (
          <ResponsiveContainer width="100%" height={300}>
            <BarChart
              data={months.current.series.map((row, idx) => ({
                month: MONTH[row.month - 1],
                current: row.revenue,
                previous: months.previous.series[idx]?.revenue || 0,
                is_peak: months.peak_months?.includes(row.month),
              }))}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
              <XAxis dataKey="month" stroke="#6B7280" fontSize={12} />
              <YAxis stroke="#6B7280" fontSize={12} tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
              <Tooltip
                formatter={(v) => formatCurrency(v)}
                contentStyle={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 8, fontSize: 12 }}
              />
              <Bar dataKey="previous" name={`${months.compare_year}`} fill="#FDBA74" radius={[4, 4, 0, 0]} />
              <Bar dataKey="current" name={`${months.year}`} radius={[4, 4, 0, 0]}>
                {months.current.series.map((row, idx) => (
                  <Cell
                    key={idx}
                    fill={months.peak_months?.includes(row.month) ? '#F97316' : '#9CA3AF'}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <div className="py-8 text-center text-sm text-ink-muted">Loading months…</div>
        )}
      </div>
    </div>
  );
}

// =======================================================================
// Tab: Forecasting
// =======================================================================
function ForecastingTab() {
  const [reorder, setReorder] = useState([]);
  const [annual, setAnnual] = useState([]);
  const [year, setYear] = useState(new Date().getFullYear());
  const [busy, setBusy] = useState(false);
  const owned = useAuthStore((s) => s.permissions) || [];
  const canManage = owned.includes('analytics.manage_reorder_settings');
  const canExport = owned.includes('analytics.export_forecast');

  const refresh = useCallback(() => {
    Promise.all([
      listReorderRecommendations({}),
      listAnnualPlan({ year }),
    ])
      .then(([r, a]) => {
        setReorder(r?.data || r || []);
        setAnnual(a?.data || a || []);
      })
      .catch(() => {});
  }, [year]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  function handleRecalculate() {
    setBusy(true);
    recalculateForecasts()
      .then(() => {
        toast.success('Forecasts recalculated.');
        refresh();
      })
      .catch((err) => toast.error(err?.message || 'Recalculation failed.'))
      .finally(() => setBusy(false));
  }

  function handleExport() {
    downloadAnnualPlanExcel({ year }).catch((err) =>
      toast.error(err?.message || 'Export failed.'),
    );
  }

  function handleDismiss(row) {
    dismissReorderRecommendation(row.id)
      .then(() => {
        toast.success('Reorder dismissed.');
        setReorder((prev) => prev.filter((r) => r.id !== row.id));
      })
      .catch((err) => toast.error(err?.message || 'Could not dismiss.'));
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-ink">Reorder recommendations</h3>
        <div className="flex items-center gap-2">
          {canManage && (
            <Button variant="secondary" onClick={handleRecalculate} disabled={busy}>
              <RefreshCw className="h-4 w-4" /> Recalculate
            </Button>
          )}
        </div>
      </div>
      <ReorderTable rows={reorder} onDismiss={canManage ? handleDismiss : null} />

      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-ink">Annual stock plan</h3>
        <div className="flex items-center gap-2">
          <Select
            value={year}
            onChange={setYear}
            options={Array.from({ length: 3 }, (_, i) => {
              const y = new Date().getFullYear() + (i - 1);
              return { value: y, label: String(y) };
            })}
            className="min-w-[120px]"
          />
          {canExport && (
            <Button variant="primary" onClick={handleExport}>
              <Download className="h-4 w-4" /> Export Excel
            </Button>
          )}
        </div>
      </div>

      {annual.length === 0 ? (
        <div className="rounded-card border border-border bg-surface p-6 text-center text-sm text-ink-muted">
          No annual plan yet. Try “Recalculate” to generate one from history.
        </div>
      ) : (
        <div className="space-y-4">
          {annual.slice(0, 8).map((plan) => (
            <div key={plan.variant_id}>
              <div className="flex items-center justify-between mb-2">
                <div>
                  <div className="font-semibold text-ink">{plan.product_name}</div>
                  <div className="text-xs text-ink-muted">
                    Total {plan.total_qty} units · {formatCurrency(plan.total_cost)} estimated
                  </div>
                </div>
              </div>
              <AnnualPlanTable plan={plan.months} totals={{ qty: plan.total_qty, cost: plan.total_cost }} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// =======================================================================
// Main page
// =======================================================================
export default function AnalyticsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = searchParams.get('tab') || 'overview';
  const [rangeCamel, setRangeCamel] = useState(() => {
    const r = defaultRange();
    return { startDate: r.start_date, endDate: r.end_date };
  });
  const range = useMemo(
    () => ({ start_date: rangeCamel.startDate, end_date: rangeCamel.endDate }),
    [rangeCamel],
  );

  const owned = useAuthStore((s) => s.permissions) || [];
  const set = new Set(owned);

  // Tabs shown adapt to the user's permissions. Hide tabs the role
  // cannot use so empty-state pages don't confuse cashiers.
  const tabs = [];
  if (set.has('analytics.view')) tabs.push({ value: 'overview', label: 'Overview', icon: <TrendingUp className="h-4 w-4" /> });
  if (set.has('analytics.view')) tabs.push({ value: 'products', label: 'Products', icon: <Package className="h-4 w-4" /> });
  if (set.has('analytics.view')) tabs.push({ value: 'suppliers', label: 'Suppliers', icon: <Truck className="h-4 w-4" /> });
  if (set.has('analytics.view')) tabs.push({ value: 'customers', label: 'Customers', icon: <Users className="h-4 w-4" /> });
  if (set.has('analytics.view')) tabs.push({ value: 'employees', label: 'Employees', icon: <UsersRound className="h-4 w-4" /> });
  if (set.has('analytics.view_peaks')) tabs.push({ value: 'peaks', label: 'Peaks', icon: <Activity className="h-4 w-4" /> });
  if (set.has('analytics.view_reorder')) tabs.push({ value: 'forecasting', label: 'Forecasting', icon: <CalendarRange className="h-4 w-4" /> });

  function setTab(value) {
    searchParams.set('tab', value);
    setSearchParams(searchParams);
  }

  return (
    <div>
      <PageHeader
        title="Analytics"
        subtitle="Demand, performance and forecasting — sliced any way you need."
      />

      <Tabs items={tabs} value={tab} onChange={setTab} className="mb-6" />

      {/* Range filter — forecasting tab doesn't need it. */}
      {tab !== 'forecasting' && (
        <div className="rounded-card border border-border bg-surface p-3 mb-6">
          <PeriodSelector
            mode="range"
            startDate={rangeCamel.startDate}
            endDate={rangeCamel.endDate}
            onChange={(next) =>
              setRangeCamel((prev) => ({
                startDate: next.startDate ?? prev.startDate,
                endDate: next.endDate ?? prev.endDate,
              }))
            }
          />
        </div>
      )}

      <PermissionGate permission="analytics.view" fallback={null}>
        {tab === 'overview' && <OverviewTab range={range} />}
        {tab === 'products' && <ProductsTab range={range} />}
        {tab === 'suppliers' && <SuppliersTab range={range} />}
        {tab === 'customers' && <CustomersTab range={range} />}
        {tab === 'employees' && <EmployeesTab range={range} />}
      </PermissionGate>
      <PermissionGate permission="analytics.view_peaks" fallback={null}>
        {tab === 'peaks' && <PeaksTab range={range} />}
      </PermissionGate>
      <PermissionGate permission="analytics.view_reorder" fallback={null}>
        {tab === 'forecasting' && <ForecastingTab />}
      </PermissionGate>
    </div>
  );
}
