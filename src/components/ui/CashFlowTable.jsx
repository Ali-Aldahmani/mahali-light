import { cn } from '../../utils/cn.js';
import { formatCurrency, formatDate } from '../../utils/format.js';

// Cash-flow statement with operating + financing buckets and an explicit
// opening/closing/change set. Outflows show in parentheses so the eye can
// scan magnitudes quickly.
export default function CashFlowTable({ data, className = '' }) {
  if (!data) return null;
  function fmt(n) {
    if (n == null) return '—';
    return n < 0 ? `(${formatCurrency(Math.abs(n))})` : formatCurrency(n);
  }
  function Row({ label, value, indent = false, bold = false, color = false }) {
    const tone = color ? (value >= 0 ? 'text-success' : 'text-error') : '';
    return (
      <tr className={cn(bold && 'font-semibold')}>
        <td className={cn('py-1.5 px-3 text-sm', indent && 'pl-8 text-ink-muted')}>
          {label}
        </td>
        <td className={cn('py-1.5 px-3 text-sm text-right font-mono', tone)}>
          {fmt(value)}
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
      <div className="px-4 py-3 border-b border-border">
        <div className="text-sm font-semibold text-ink">Cash Flow Statement</div>
        <div className="text-xs text-ink-muted">
          {formatDate(data.startDate)} – {formatDate(data.endDate)}
        </div>
      </div>
      <table className="w-full">
        <tbody>
          <Section title="Operating Activities" />
          <Row label="Cash from Sales" value={data.operating.cashFromSales} indent />
          <Row label="Cash from Collections" value={data.operating.cashFromCollections} indent />
          <Row label="Paid to Suppliers" value={-data.operating.paidToSuppliers} indent />
          <Row label="Bills Paid" value={-data.operating.billsPaid} indent />
          <Row label="Expenses Paid" value={-data.operating.expensesPaid} indent />
          <Row label="Refunds Paid" value={-data.operating.refundsPaid} indent />
          <Row label="Net Operating" value={data.operating.net} bold color />

          <Section title="Financing Activities" />
          <Row label="Manual Deposits" value={data.financing.manualDeposits} indent />
          <Row label="Manual Withdrawals" value={-data.financing.manualWithdrawals} indent />
          <Row label="Net Financing" value={data.financing.net} bold color />

          <tr><td colSpan={2} className="border-t border-border" /></tr>
          <Row label="Net Cash Change" value={data.netCashChange} bold color />
          <Row label="Opening Cash Balance" value={data.openingCash} indent />
          <Row label="Closing Cash Balance" value={data.closingCash} bold />
        </tbody>
      </table>
    </div>
  );
}
