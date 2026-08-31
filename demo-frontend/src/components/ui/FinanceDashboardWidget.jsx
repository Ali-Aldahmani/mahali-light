import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight,
  TrendingUp,
  TrendingDown,
  Calendar,
  Wallet,
} from 'lucide-react';
import { useFinanceStore } from '../../store/financeStore.js';
import { formatCurrency } from '../../utils/format.js';
import { cn } from '../../utils/cn.js';
import Spinner from './Spinner.jsx';
import Button from './Button.jsx';

function deltaClass(delta, invert = false) {
  if (delta == null) return 'text-ink-muted';
  const up = delta > 0;
  const positive = invert ? !up : up;
  if (delta === 0) return 'text-ink-muted';
  return positive ? 'text-success' : 'text-error';
}

function deltaArrow(delta, invert = false) {
  if (delta == null || delta === 0) return null;
  const up = delta > 0;
  const Show = up ? TrendingUp : TrendingDown;
  return <Show className={cn('h-3.5 w-3.5', deltaClass(delta, invert))} />;
}

// Compact finance widget for the main app dashboard. Pulls from the shared
// store so multiple consumers share one snapshot (re-fetched every 60s).
export default function FinanceDashboardWidget({ className = '' }) {
  const snapshot = useFinanceStore((s) => s.snapshot);
  const refresh = useFinanceStore((s) => s.refreshSnapshot);
  const loading = useFinanceStore((s) => s.loading);

  useEffect(() => {
    refresh().catch(() => {});
  }, [refresh]);

  if (loading && !snapshot) {
    return (
      <div className={cn('rounded-card border border-border bg-surface p-4 flex items-center justify-center', className)}>
        <Spinner size="sm" />
      </div>
    );
  }
  if (!snapshot) return null;

  return (
    <div className={cn('rounded-card border border-border bg-surface p-4', className)}>
      <div className="flex items-center justify-between mb-3">
        <div>
          <div className="text-sm font-semibold text-ink">Financial Snapshot</div>
          <div className="text-xs text-ink-muted">
            {new Date(snapshot.periodStart).toLocaleString('default', {
              month: 'long',
              year: 'numeric',
            })}
          </div>
        </div>
        <Link to="/finance">
          <Button variant="ghost" size="sm" rightIcon={<ArrowRight size={14} />}>
            View finance
          </Button>
        </Link>
      </div>

      <div className="space-y-2 text-sm">
        <Row
          label="Revenue"
          value={snapshot.revenue.mtd}
          delta={snapshot.revenue.delta}
          deltaLabel="vs last month"
        />
        <Row
          label="Expenses"
          value={snapshot.expenses.mtd}
          delta={snapshot.expenses.delta}
          deltaLabel="vs last month"
          invertColor
        />
        <Row
          label="Net Profit"
          value={snapshot.netProfit.mtd}
          delta={snapshot.netProfit.delta}
          deltaLabel="vs last month"
          bold
          colorByValue
        />
      </div>

      <div className="border-t border-border my-3" />

      <div className="space-y-1.5 text-sm">
        <Row
          label={
            <span className="inline-flex items-center gap-1.5">
              <Wallet className="h-3.5 w-3.5" /> Cash + banks
            </span>
          }
          value={snapshot.cash}
        />
        <Row label="Receivables" value={snapshot.receivables} muted />
        <Row label="Payables" value={snapshot.payables} muted />
      </div>

      <div className="border-t border-border my-3" />

      <Row
        label={
          <span className="inline-flex items-center gap-1.5">
            <Calendar className="h-3.5 w-3.5" /> VAT due
          </span>
        }
        value={snapshot.vatPayable}
        deltaLabel={`in ${snapshot.vatDaysLeft} days`}
      />
    </div>
  );
}

function Row({
  label,
  value,
  delta = null,
  deltaLabel = null,
  invertColor = false,
  bold = false,
  muted = false,
  colorByValue = false,
}) {
  const valColor = colorByValue
    ? value >= 0
      ? 'text-success'
      : 'text-error'
    : '';
  return (
    <div className={cn('flex items-center justify-between', muted && 'text-ink-muted')}>
      <span>{label}</span>
      <div className="flex items-center gap-2">
        {delta != null && (
          <span
            className={cn(
              'inline-flex items-center gap-0.5 text-xs',
              deltaClass(delta, invertColor),
            )}
          >
            {deltaArrow(delta, invertColor)}
            {Math.abs(delta).toFixed(1)}%
          </span>
        )}
        <span className={cn('font-mono', bold && 'font-semibold', valColor)}>
          {formatCurrency(value)}
        </span>
        {deltaLabel && delta == null && (
          <span className="text-xs text-ink-muted">{deltaLabel}</span>
        )}
      </div>
    </div>
  );
}
