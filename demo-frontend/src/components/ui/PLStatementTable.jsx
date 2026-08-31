import { cn } from '../../utils/cn.js';
import { formatCurrency } from '../../utils/format.js';

// Renders a full P&L statement. `data` is the response from /finance/pl —
// optionally with `previous` and `delta` for the side-by-side compare view.
export default function PLStatementTable({ data, className = '' }) {
  if (!data) return null;
  const showCompare = !!data.previous;

  function Row({ label, current, prev, bold = false, indent = false, profit = false }) {
    const colorCurrent = profit
      ? current >= 0
        ? 'text-success'
        : 'text-error'
      : '';
    const colorPrev = profit
      ? prev >= 0
        ? 'text-success'
        : 'text-error'
      : '';
    return (
      <tr className={cn(bold && 'font-semibold')}>
        <td
          className={cn(
            'py-2 px-3 text-sm',
            indent && 'pl-8 text-ink-muted',
            bold && 'text-ink',
          )}
        >
          {label}
        </td>
        <td className={cn('py-2 px-3 text-sm text-right font-mono', colorCurrent)}>
          {current != null ? (typeof current === 'number' ? formatCurrency(current) : current) : '—'}
        </td>
        {showCompare && (
          <td
            className={cn(
              'py-2 px-3 text-sm text-right font-mono text-ink-muted',
              colorPrev,
            )}
          >
            {prev != null ? (typeof prev === 'number' ? formatCurrency(prev) : prev) : '—'}
          </td>
        )}
      </tr>
    );
  }

  function Section({ title }) {
    return (
      <tr className="bg-surface-2">
        <td colSpan={showCompare ? 3 : 2} className="py-1.5 px-3 text-xs uppercase tracking-wide text-ink-muted">
          {title}
        </td>
      </tr>
    );
  }

  return (
    <div className={cn('rounded-card border border-border bg-surface overflow-hidden', className)}>
      <table className="w-full">
        <thead>
          <tr className="border-b border-border bg-surface-2">
            <th className="text-left py-2 px-3 text-xs uppercase tracking-wide text-ink-muted">
              Account
            </th>
            <th className="text-right py-2 px-3 text-xs uppercase tracking-wide text-ink-muted">
              This period
            </th>
            {showCompare && (
              <th className="text-right py-2 px-3 text-xs uppercase tracking-wide text-ink-muted">
                Previous
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          <Section title="Revenue" />
          {data.revenue.lines.map((r, i) => (
            <Row
              key={`rev-${r.code}`}
              label={r.name}
              current={r.amount}
              prev={data.previous?.revenue?.lines?.find((l) => l.code === r.code)?.amount ?? 0}
              indent
            />
          ))}
          <Row label="Total Revenue" current={data.revenue.total}
            prev={data.previous?.revenue?.total} bold />

          <Section title="Cost of Goods Sold" />
          <Row label="Cost of Sales" current={data.cogs.total}
            prev={data.previous?.cogs?.total} indent />
          <Row label="Gross Profit" current={data.grossProfit}
            prev={data.previous?.grossProfit} bold profit />
          <Row
            label="Gross Margin %"
            current={`${data.grossMargin.toFixed(1)}%`}
            prev={data.previous ? `${data.previous.grossMargin.toFixed(1)}%` : null}
          />

          <Section title="Operating Expenses" />
          {data.expenses.lines.length === 0 ? (
            <tr>
              <td colSpan={showCompare ? 3 : 2} className="py-3 px-3 text-sm text-ink-muted text-center">
                No operating expenses in this period.
              </td>
            </tr>
          ) : (
            data.expenses.lines.map((r) => (
              <Row
                key={`exp-${r.code}`}
                label={r.name}
                current={r.amount}
                prev={data.previous?.expenses?.lines?.find((l) => l.code === r.code)?.amount ?? 0}
                indent
              />
            ))
          )}
          <Row label="Total Expenses" current={data.expenses.total}
            prev={data.previous?.expenses?.total} bold />

          <tr><td colSpan={showCompare ? 3 : 2} className="border-t border-border" /></tr>
          <Row label="Net Profit" current={data.netProfit}
            prev={data.previous?.netProfit} bold profit />
          <Row
            label="Net Margin %"
            current={`${data.netMargin.toFixed(1)}%`}
            prev={data.previous ? `${data.previous.netMargin.toFixed(1)}%` : null}
          />
        </tbody>
      </table>
    </div>
  );
}
