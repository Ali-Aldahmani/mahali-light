'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowLeft, AlertCircle } from 'lucide-react';
import PageHeader from '@/components/ui/PageHeader';
import Button from '@/components/ui/Button';
import Spinner from '@/components/ui/Spinner';
import Input from '@/components/ui/Input';
import Select from '@/components/ui/Select';
import EmptyState from '@/components/ui/EmptyState';
import ReportFiltersBar from '@/components/reports/ReportFiltersBar';
import ReportExportBar from '@/components/reports/ReportExportBar';
import ReportTable, { formatCell } from '@/components/reports/ReportTable';
import AgingTable from '@/components/reports/AgingTable';
import EmployeeLeaderboard from '@/components/reports/EmployeeLeaderboard';
import PayrollSummaryTable from '@/components/reports/PayrollSummaryTable';
import AttendanceGridReport from '@/components/reports/AttendanceGridReport';
import SalesChart from '@/components/reports/SalesChart';
import CategoryBreakdownChart from '@/components/reports/CategoryBreakdownChart';
import { runReport, findReport } from '@/services/reportService';
import { getQuickRange } from '@/components/ui/PeriodSelector';
import { toast } from '@/store/toastStore';

// Some report types want extra UI on top of the generic filter/table layout.
// Identifying them by type keeps the page renderer thin and predictable.
const SPECIAL_VIEWS: Record<string, string> = {
  customer_receivables: 'aging',
  supplier_payables: 'aging',
  sales_by_employee: 'leaderboard',
  employee_performance: 'leaderboard',
  payroll: 'payroll',
  attendance_monthly_sheet: 'attendance-grid',
  sales_by_period: 'sales-chart',
  sales_by_category: 'pie',
};

const DEFAULT_PARAMS = () => {
  const r = getQuickRange('this_month');
  return { start_date: r.startDate, end_date: r.endDate };
};

function summaryEntryLabel(key: string) {
  return key
    .replace(/([A-Z])/g, ' $1')
    .replace(/_/g, ' ')
    .replace(/^./, (c) => c.toUpperCase())
    .trim();
}

function summaryEntryValue(key: string, value: unknown) {
  if (typeof value !== 'number') return String(value ?? '—');
  const lower = key.toLowerCase();
  if (lower.includes('count')) return formatCell(value, 'int');
  if (lower.includes('rate') || lower.endsWith('pct')) return formatCell(value, 'percent');
  return formatCell(value, 'currency');
}

export default function ReportPage() {
  const { category, type } = useParams<{ category: string; type: string }>();
  const definition = useMemo(() => findReport(type), [type]);
  const [filters, setFilters] = useState<any>(() => DEFAULT_PARAMS());
  const [extraFilters, setExtraFilters] = useState<any>({});
  const [report, setReport] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(overrideFilters?: any) {
    const all = { ...filters, ...extraFilters, ...(overrideFilters || {}) };
    try {
      setLoading(true);
      setError(null);
      const data = await runReport(type, all);
      setReport(data);
    } catch (err: any) {
      setError(err.message || 'Failed to load report.');
      toast.error(err.message || 'Failed to load report.');
    } finally {
      setLoading(false);
    }
  }

  // Auto-run on first mount so the user sees data immediately for the
  // current month. We only re-run when the *type* changes (i.e. a different
  // report is navigated to) — filter changes use the explicit Run button.
  useEffect(() => {
    setReport(null);
    setExtraFilters({});
    setFilters(DEFAULT_PARAMS());
    run(DEFAULT_PARAMS());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type]);

  if (!definition) {
    return (
      <div className="space-y-4">
        <PageHeader title="Report not found" />
        <EmptyState
          icon={<AlertCircle size={28} />}
          title="Unknown report"
          description={`Report "${type}" does not exist.`}
          action={
            <Link href="/reports">
              <Button leftIcon={<ArrowLeft size={16} />}>Back to Reports</Button>
            </Link>
          }
        />
      </div>
    );
  }

  const exportParams = { ...filters, ...extraFilters };
  const specialView = SPECIAL_VIEWS[type];

  return (
    <div className="space-y-4">
      <PageHeader
        title={definition.label}
        subtitle={definition.category?.title}
        action={
          <Link href="/reports">
            <Button variant="secondary" leftIcon={<ArrowLeft size={16} />}>
              All Reports
            </Button>
          </Link>
        }
      />

      <ReportFiltersBar
        startDate={filters.start_date}
        endDate={filters.end_date}
        onPeriodChange={(p: any) =>
          setFilters({ ...filters, start_date: p.startDate, end_date: p.endDate })
        }
        onRun={() => run()}
        onReset={() => {
          setExtraFilters({});
          const def = DEFAULT_PARAMS();
          setFilters(def);
          run(def);
        }}
        loading={loading}
        hidePeriod={[
          'inventory_stock_levels',
          'inventory_valuation',
          'low_stock',
          'dead_stock',
          'customer_inactive',
          'customer_receivables',
          'supplier_payables',
          'warranty_active',
          'bills_summary',
          'bills_overdue',
          'attendance_leave',
          'attendance_monthly_sheet',
          'payroll',
        ].includes(type)}
        extras={renderExtras(type, extraFilters, setExtraFilters)}
      />

      <div className="flex items-center justify-between">
        <div className="text-xs text-ink-muted">
          {report?.meta?.rowCount != null && (
            <span>{report.meta.rowCount.toLocaleString()} row(s)</span>
          )}
          {report?.period?.label && <span className="ml-2">· {report.period.label}</span>}
        </div>
        <ReportExportBar type={type} params={exportParams} />
      </div>

      {report?.summary && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {Object.entries(report.summary).map(([key, value]) => (
            <div key={key} className="card border border-border p-4">
              <p className="text-xs uppercase tracking-wide text-ink-muted">
                {summaryEntryLabel(key)}
              </p>
              <p className="mt-1 text-lg font-semibold text-ink">
                {summaryEntryValue(key, value)}
              </p>
            </div>
          ))}
        </div>
      )}

      {loading ? (
        <div className="card border border-border p-12 flex items-center justify-center">
          <Spinner size="md" className="text-accent" />
        </div>
      ) : error ? (
        <EmptyState
          icon={<AlertCircle size={28} />}
          title="Failed to load report"
          description={error}
        />
      ) : report ? (
        <SpecialOrGeneric specialView={specialView} report={report} category={category} />
      ) : (
        <EmptyState title="Run the report" description="Set your filters and hit Run Report." />
      )}
    </div>
  );
}

function renderExtras(type: string, extra: any, setExtra: (v: any) => void) {
  const onChange = (patch: any) => setExtra({ ...extra, ...patch });
  if (type === 'sales_by_period') {
    return (
      <div className="flex items-center gap-2">
        <span className="text-sm text-ink-muted">Group by:</span>
        <Select
          value={extra.group_by || 'day'}
          onChange={(v: any) => onChange({ group_by: v })}
          options={[
            { value: 'day', label: 'Day' },
            { value: 'week', label: 'Week' },
            { value: 'month', label: 'Month' },
            { value: 'year', label: 'Year' },
          ]}
          searchable={false}
          className="w-32"
        />
      </div>
    );
  }
  if (type === 'dead_stock' || type === 'customer_inactive') {
    return (
      <div className="flex items-center gap-2">
        <span className="text-sm text-ink-muted">Days inactive:</span>
        <Input
          type="number"
          min={1}
          value={extra.days || ''}
          placeholder={type === 'dead_stock' ? '30' : '60'}
          onChange={(e: any) => onChange({ days: Number(e.target.value) || undefined })}
          className="w-24"
        />
      </div>
    );
  }
  if (type === 'sales_by_product') {
    return (
      <div className="flex items-center gap-2">
        <span className="text-sm text-ink-muted">Sort by:</span>
        <Select
          value={extra.sort || 'revenue'}
          onChange={(v: any) => onChange({ sort: v })}
          options={[
            { value: 'revenue', label: 'Revenue' },
            { value: 'profit', label: 'Profit' },
            { value: 'margin', label: 'Margin %' },
            { value: 'quantity', label: 'Quantity' },
          ]}
          searchable={false}
          className="w-40"
        />
      </div>
    );
  }
  if (type === 'attendance_monthly_sheet' || type === 'payroll') {
    const now = new Date();
    return (
      <div className="flex items-center gap-2">
        <span className="text-sm text-ink-muted">Month:</span>
        <Input
          type="number"
          min={1}
          max={12}
          value={extra.month || now.getMonth() + 1}
          onChange={(e: any) => onChange({ month: Number(e.target.value) || undefined })}
          className="w-16"
        />
        <span className="text-sm text-ink-muted">Year:</span>
        <Input
          type="number"
          min={2020}
          max={2100}
          value={extra.year || now.getFullYear()}
          onChange={(e: any) => onChange({ year: Number(e.target.value) || undefined })}
          className="w-24"
        />
      </div>
    );
  }
  return null;
}

function SpecialOrGeneric({
  specialView,
  report,
}: {
  specialView?: string;
  report: any;
  category?: string;
}) {
  if (specialView === 'aging') {
    return <AgingTable report={report} />;
  }
  if (specialView === 'leaderboard') {
    return (
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <EmployeeLeaderboard report={report} />
        <ReportTable report={report} />
      </div>
    );
  }
  if (specialView === 'payroll') {
    return <PayrollSummaryTable report={report} />;
  }
  if (specialView === 'attendance-grid') {
    return <AttendanceGridReport report={report} />;
  }
  if (specialView === 'sales-chart') {
    return (
      <div className="space-y-4">
        <SalesChart rows={report.rows || []} />
        <ReportTable report={report} />
      </div>
    );
  }
  if (specialView === 'pie') {
    return (
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <CategoryBreakdownChart rows={report.rows || []} />
        <ReportTable report={report} />
      </div>
    );
  }
  return <ReportTable report={report} />;
}
