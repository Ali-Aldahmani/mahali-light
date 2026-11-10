import { cn } from '@/lib/utils/cn';
import { formatCurrency, formatDate } from '@/lib/utils/format';

// Balance sheet from every ledger account. Equity is the equity accounts plus
// earnings not yet closed to them, never assets minus liabilities, so an
// imbalance in the books shows here instead of being absorbed.
export default function BalanceSheetTable({ data, className = '' }) {
  if (!data) return null;
  const liabPlusEquity = (data.liabilities.total || 0) + (data.equity.total ?? data.equity.netEquity ?? 0);
  const balanced = data.balanced ?? Math.abs((data.assets.total || 0) - liabPlusEquity) < 0.01;
  const lines = (list = []) => list.map((l) => <Row key={l.code} label={`${l.code} · ${l.name}`} value={l.amount} indent />);

  function Row({ label, value, indent = false, bold = false }) {
    return (
      <tr className={cn(bold && 'font-semibold')}>
        <td className={cn('py-1.5 px-3 text-sm', indent && 'pl-8 text-ink-muted')}>
          {label}
        </td>
        <td className="py-1.5 px-3 text-sm text-right font-mono">
          {typeof value === 'number' ? formatCurrency(value) : value}
        </td>
      </tr>
    );
  }

  function Section({ title }) {
    return (
      <tr className="bg-surface-2">
        <td colSpan={2} className="py-1.5 px-3 text-xs uppercase tracking-wide text-ink-muted">
          {title}
        </td>
      </tr>
    );
  }

  return (
    <div className={cn('rounded-card border border-border bg-surface overflow-hidden', className)}>
      <div className="px-4 py-3 border-b border-border flex items-center justify-between">
        <div>
          <div className="text-sm font-semibold text-ink">Balance Sheet</div>
          <div className="text-xs text-ink-muted">As of {formatDate(data.asOfDate)}</div>
        </div>
        <span
          className={cn(
            'rounded-full px-2.5 py-0.5 text-xs',
            balanced ? 'bg-success-light text-success' : 'bg-error-light text-error',
          )}
        >
          {balanced ? 'Balanced' : 'Out of balance'}
        </span>
      </div>
      <table className="w-full">
        <tbody>
          <Section title="Assets" />
          {lines(data.assets.lines)}
          <Row label="Total Assets" value={data.assets.total} bold />

          <Section title="Liabilities" />
          {lines(data.liabilities.lines)}
          <Row label="Total Liabilities" value={data.liabilities.total} bold />

          <Section title="Equity" />
          {lines(data.equity.lines)}
          {data.equity.priorEarnings != null && (
            <Row label="Retained earnings (earlier years)" value={data.equity.priorEarnings} indent />
          )}
          {data.equity.currentYearEarnings != null && (
            <Row label="Profit this fiscal year" value={data.equity.currentYearEarnings} indent />
          )}
          <Row label="Total Equity" value={data.equity.total ?? data.equity.netEquity} bold />
          <Row label="Liabilities + Equity" value={liabPlusEquity} bold />
          {!balanced && data.difference != null && (
            <Row label="Difference (books out of balance)" value={data.difference} bold />
          )}
          {data.assets.banks?.length > 0 && (
            <>
              <Section title="Bank accounts today (for reference)" />
              {data.assets.banks.map((b) => (
                <Row key={b.id} label={b.label} value={b.balance} indent />
              ))}
            </>
          )}
        </tbody>
      </table>
    </div>
  );
}
