import { cn } from '../../utils/cn.js';
import { formatCurrency, formatDate } from '../../utils/format.js';

// Three-block balance sheet display. Hard-fails if assets ≠ liabilities +
// equity by more than a few fils — surfaces a visible warning to the user.
export default function BalanceSheetTable({ data, className = '' }) {
  if (!data) return null;
  const liabPlusEquity = (data.liabilities.total || 0) + (data.equity.netEquity || 0);
  const balanced = Math.abs((data.assets.total || 0) - liabPlusEquity) < 0.01;

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
          <Row label="Cash in Drawer" value={data.assets.cash} indent />
          {data.assets.banks.map((b) => (
            <Row key={b.id} label={`Bank — ${b.label}`} value={b.balance} indent />
          ))}
          <Row label="Accounts Receivable" value={data.assets.receivables} indent />
          <Row label="Inventory Value" value={data.assets.inventory} indent />
          <Row label="Total Assets" value={data.assets.total} bold />

          <Section title="Liabilities" />
          <Row label="Accounts Payable" value={data.liabilities.payables} indent />
          <Row label="VAT Payable" value={data.liabilities.vatPayable} indent />
          <Row label="Total Liabilities" value={data.liabilities.total} bold />

          <Section title="Equity" />
          <Row label="Net Equity" value={data.equity.netEquity} bold />
        </tbody>
      </table>
    </div>
  );
}
