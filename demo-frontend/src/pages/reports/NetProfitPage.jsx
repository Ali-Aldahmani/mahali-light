import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, ChevronLeft, ChevronRight } from 'lucide-react';
import PageHeader from '../../components/ui/PageHeader.jsx';
import Button from '../../components/ui/Button.jsx';
import Spinner from '../../components/ui/Spinner.jsx';
import NetProfitChart from '../../components/reports/NetProfitChart.jsx';
import ReportTable, { formatCell } from '../../components/reports/ReportTable.jsx';
import ComparisonBadge from '../../components/reports/ComparisonBadge.jsx';
import ReportExportBar from '../../components/reports/ReportExportBar.jsx';
import { runReport } from '../../services/reportService.js';
import { toast } from '../../store/toastStore.js';

const PERIODS = [
  { id: 'daily',     label: 'Daily' },
  { id: 'monthly',   label: 'Monthly' },
  { id: 'quarterly', label: 'Quarterly' },
  { id: 'halfyear',  label: 'Half-Year' },
  { id: 'yearly',    label: 'Yearly' },
];

function monthName(idx) {
  return new Date(2000, idx, 1).toLocaleString('default', { month: 'long' });
}

export default function NetProfitPage() {
  const now = new Date();
  const [period, setPeriod] = useState('monthly');
  const [year, setYear] = useState(now.getFullYear());
  const [monthIdx, setMonthIdx] = useState(now.getMonth()); // 0-11
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(false);

  const params = useMemo(() => {
    if (period === 'daily') {
      // Daily mode focuses on the selected month for clarity.
      const start = new Date(Date.UTC(year, monthIdx, 1)).toISOString().slice(0, 10);
      const end = new Date(Date.UTC(year, monthIdx + 1, 0)).toISOString().slice(0, 10);
      return { period: 'daily', start_date: start, end_date: end };
    }
    return { period, year };
  }, [period, year, monthIdx]);

  async function run() {
    try {
      setLoading(true);
      const data = await runReport('net_profit', params);
      setReport(data);
    } catch (err) {
      toast.error(err.message || 'Failed to load net profit.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period, year, monthIdx]);

  // Build the "current vs previous" comparison off the report's totals
  // (period buckets). When monthly, the current month is the one matching
  // `monthIdx`; we surface it next to the previous month for a quick delta.
  const summary = useMemo(() => {
    if (!report?.rows?.length) return null;
    if (period === 'monthly') {
      const cur = report.rows[monthIdx];
      const prev = monthIdx > 0 ? report.rows[monthIdx - 1] : null;
      return { current: cur, previous: prev, label: `${monthName(monthIdx)} ${year}` };
    }
    // For other modes the latest row is "current".
    return {
      current: report.rows[report.rows.length - 1],
      previous: report.rows[report.rows.length - 2] || null,
      label: report.rows[report.rows.length - 1]?.period || '',
    };
  }, [report, period, monthIdx, year]);

  function delta(curr, prev) {
    if (!curr || !prev || !prev.net_profit) return null;
    return ((curr.net_profit - prev.net_profit) / Math.abs(prev.net_profit)) * 100;
  }

  function shiftPeriod(direction) {
    if (period === 'monthly' || period === 'daily') {
      let m = monthIdx + direction;
      let y = year;
      if (m < 0) {
        m = 11;
        y -= 1;
      } else if (m > 11) {
        m = 0;
        y += 1;
      }
      setMonthIdx(m);
      setYear(y);
    } else {
      setYear((prev) => prev + direction);
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Net Profit"
        subtitle="Live calculation from the journal — choose a period type and drill in."
        action={
          <Link to="/reports">
            <Button variant="secondary" leftIcon={<ArrowLeft size={16} />}>
              All Reports
            </Button>
          </Link>
        }
      />

      <div className="card border border-border p-4 flex flex-wrap items-center gap-4">
        <div className="flex flex-wrap gap-1.5">
          {PERIODS.map((p) => (
            <Button
              key={p.id}
              variant={period === p.id ? 'primary' : 'secondary'}
              size="sm"
              onClick={() => setPeriod(p.id)}
            >
              {p.label}
            </Button>
          ))}
        </div>
        <div className="flex items-center gap-2 ml-auto">
          <Button variant="ghost" size="sm" onClick={() => shiftPeriod(-1)}>
            <ChevronLeft size={16} />
          </Button>
          <span className="font-medium text-ink text-sm min-w-[160px] text-center">
            {period === 'monthly' || period === 'daily'
              ? `${monthName(monthIdx)} ${year}`
              : `${year}`}
          </span>
          <Button variant="ghost" size="sm" onClick={() => shiftPeriod(1)}>
            <ChevronRight size={16} />
          </Button>
        </div>
        <ReportExportBar type="net_profit" params={params} />
      </div>

      {loading ? (
        <div className="card border border-border p-12 flex items-center justify-center">
          <Spinner size="md" className="text-accent" />
        </div>
      ) : (
        <>
          {summary?.current && (
            <NetProfitCard
              label={`Net Profit — ${summary.label}`}
              row={summary.current}
              change={delta(summary.current, summary.previous)}
              previousLabel={summary.previous?.period}
            />
          )}
          <NetProfitChart rows={report?.rows || []} />
          {report && <ReportTable report={report} />}
        </>
      )}
    </div>
  );
}

function NetProfitCard({ label, row, change, previousLabel }) {
  const grossPct = row.gross_margin != null ? `${row.gross_margin.toFixed(1)}%` : '—';
  const netPct = row.net_margin != null ? `${row.net_margin.toFixed(1)}%` : '—';
  return (
    <div className="card border border-border p-6 grid gap-4 lg:grid-cols-2">
      <div>
        <p className="text-xs uppercase tracking-wide text-ink-muted">{label}</p>
        <div className="mt-2 grid gap-2 text-sm">
          <Row label="Revenue" value={formatCell(row.revenue, 'currency')} />
          <Row
            label="Cost of Sales"
            value={`(${formatCell(row.cogs, 'currency')?.replace('AED ', '')})`}
            mono
          />
          <Row
            label="Gross Profit"
            value={formatCell(row.gross_profit, 'currency')}
            trailing={grossPct}
            bold
          />
          <Row
            label="Expenses"
            value={`(${formatCell(row.expenses, 'currency')?.replace('AED ', '')})`}
            mono
          />
        </div>
      </div>
      <div className="border-t lg:border-t-0 lg:border-l border-border pt-4 lg:pt-0 lg:pl-6 flex flex-col justify-center">
        <p className="text-xs uppercase tracking-wide text-ink-muted">Net Profit</p>
        <p className="mt-1 text-3xl font-semibold text-ink">
          {formatCell(row.net_profit, 'currency')}
        </p>
        <p className="text-sm text-ink-muted">Net margin {netPct}</p>
        {previousLabel && (
          <div className="mt-3 flex items-center gap-2 text-sm">
            <span className="text-ink-muted">vs {previousLabel}</span>
            <ComparisonBadge change={change} />
          </div>
        )}
      </div>
    </div>
  );
}

function Row({ label, value, trailing = '', bold = false, mono = false }) {
  return (
    <div className="flex items-center justify-between">
      <span className={bold ? 'font-semibold text-ink' : 'text-ink-muted'}>{label}</span>
      <span className={`tabular-nums ${bold ? 'font-semibold' : ''} ${mono ? 'text-ink' : ''}`}>
        {value} {trailing && <span className="text-ink-muted ml-2">{trailing}</span>}
      </span>
    </div>
  );
}
