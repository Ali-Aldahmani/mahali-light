import { useEffect, useState } from 'react';
import { Printer, X, CheckCircle2, AlertTriangle } from 'lucide-react';
import { getCashSession } from '../../../services/cashDrawerService.js';
import { formatCurrency, formatDateTime } from '../../../utils/format.js';
import Button from '../../../components/ui/Button.jsx';

const TYPE_GROUPS = [
  { key: 'sale', label: 'Sales' },
  { key: 'customer_payment', label: 'Customer collections' },
  { key: 'manual_in', label: 'Manual additions' },
  { key: 'transfer', label: 'Transfers in' },
];
const OUT_GROUPS = [
  { key: 'supplier_payment', label: 'Supplier payments' },
  { key: 'refund', label: 'Refunds' },
  { key: 'expense', label: 'Expenses' },
  { key: 'manual_out', label: 'Manual removals' },
  { key: 'transfer', label: 'Transfers out' },
];

// Printable daily reconciliation summary. Loaded lazily after the cashier
// closes the drawer — uses the session summary endpoint to pull aggregates.
export default function ReconciliationSummary({ data, onClear }) {
  const [summary, setSummary] = useState(null);

  useEffect(() => {
    if (!data?.sessionId) return;
    let cancelled = false;
    getCashSession(data.sessionId)
      .then((res) => {
        if (!cancelled) setSummary(res);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [data?.sessionId]);

  if (!data) return null;

  const session = summary?.session;
  const totals = summary?.totals || { in: 0, out: 0, byType: {} };
  const expected = Number(data.expectedBalance || 0);
  const counted = Number(data.countedBalance || 0);
  const discrepancy = Number(data.discrepancy || 0);
  const balanced = Math.abs(discrepancy) < 0.01;

  function getCount(type, dir) {
    return Number(totals.byType?.[`${type}:${dir}`]?.total || 0);
  }

  return (
    <div className="rounded-card border border-border bg-surface p-5 shadow-sm relative print:shadow-none">
      <button
        type="button"
        onClick={onClear}
        className="absolute right-4 top-4 text-ink-muted hover:text-ink"
        title="Dismiss"
      >
        <X className="h-4 w-4" />
      </button>
      <div className="flex items-start justify-between mb-4 gap-3">
        <div>
          <div className="text-sm font-semibold text-ink">
            Cash drawer — daily summary
          </div>
          <div className="text-xs text-ink-muted">
            {session
              ? `${formatDateTime(session.openedAt)} → ${formatDateTime(
                  session.closedAt,
                )}`
              : '—'}
          </div>
          <div className="text-xs text-ink-muted mt-0.5">
            Opened by {session?.openedByUsername || '—'} · Closed by{' '}
            {session?.closedByUsername || '—'}
          </div>
        </div>
        <Button
          variant="secondary"
          leftIcon={<Printer className="h-4 w-4" />}
          onClick={() => window.print()}
        >
          Print
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="rounded-card bg-surface-2 p-3">
          <div className="text-xs text-ink-muted">Opening balance</div>
          <div className="text-lg font-semibold text-ink">
            {formatCurrency(session?.openingBalance || 0)}
          </div>
        </div>
        <div className="rounded-card bg-success-light p-3">
          <div className="text-xs text-success/80">Cash in</div>
          <div className="text-lg font-semibold text-success">
            +{formatCurrency(totals.in)}
          </div>
        </div>
        <div className="rounded-card bg-error-light p-3">
          <div className="text-xs text-error/80">Cash out</div>
          <div className="text-lg font-semibold text-error">
            −{formatCurrency(totals.out)}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-4">
        <div className="rounded-card border border-border p-3">
          <div className="text-xs font-medium text-ink-muted mb-2">
            Money in breakdown
          </div>
          <ul className="text-sm space-y-1">
            {TYPE_GROUPS.map((g) => (
              <li key={g.key} className="flex justify-between">
                <span className="text-ink-muted">{g.label}</span>
                <span>{formatCurrency(getCount(g.key, 'in'))}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="rounded-card border border-border p-3">
          <div className="text-xs font-medium text-ink-muted mb-2">
            Money out breakdown
          </div>
          <ul className="text-sm space-y-1">
            {OUT_GROUPS.map((g) => (
              <li key={g.key} className="flex justify-between">
                <span className="text-ink-muted">{g.label}</span>
                <span>{formatCurrency(getCount(g.key, 'out'))}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="rounded-card bg-surface-2 p-3">
          <div className="text-xs text-ink-muted">Expected balance</div>
          <div className="text-lg font-semibold">
            {formatCurrency(expected)}
          </div>
        </div>
        <div className="rounded-card bg-surface-2 p-3">
          <div className="text-xs text-ink-muted">Counted cash</div>
          <div className="text-lg font-semibold">
            {formatCurrency(counted)}
          </div>
        </div>
        <div
          className={`rounded-card p-3 ${
            balanced
              ? 'bg-success-light text-success'
              : 'bg-error-light text-error'
          }`}
        >
          <div className="text-xs">Discrepancy</div>
          <div className="text-lg font-semibold inline-flex items-center gap-1">
            {balanced ? (
              <CheckCircle2 className="h-4 w-4" />
            ) : (
              <AlertTriangle className="h-4 w-4" />
            )}
            {discrepancy >= 0 ? '+' : '−'}
            {formatCurrency(Math.abs(discrepancy))}
          </div>
        </div>
      </div>
    </div>
  );
}
