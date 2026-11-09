import Link from 'next/link';
import { cn } from '@/lib/utils/cn';
import { formatCurrency, formatQty } from '@/lib/utils/format';

function RankBadge({ rank }) {
  const palette =
    rank === 1
      ? 'bg-amber-100 text-amber-700'
      : rank === 2
        ? 'bg-zinc-200 text-zinc-700'
        : rank === 3
          ? 'bg-orange-100 text-orange-700'
          : 'bg-surface-2 text-ink-muted';
  return (
    <span
      className={cn(
        'inline-flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold',
        palette,
      )}
    >
      {rank}
    </span>
  );
}

const hasCost = (rows) => rows.some((r) => r.gross_profit !== undefined);

// Ranked product list. Compact = use in dashboard column. Verbose adds COGS,
// gross profit, margin and returns. Cost columns appear only when the API sent
// them (it leaves them out for users without product.view_cost).
export default function TopProductsTable({
  rows = [],
  verbose = false,
  emptyText = 'No sales in this period.',
  showCategory = false,
  linkTo = (row) => `/products/${row.product_id}`,
  className = '',
}) {
  if (!rows.length) {
    return (
      <div className={cn('rounded-card border border-border bg-surface p-6 text-center text-sm text-ink-muted flex items-center justify-center', className)}>
        {emptyText}
      </div>
    );
  }
  const cost = hasCost(rows);
  return (
    <div className={cn('rounded-card border border-border bg-surface overflow-x-auto', className)}>
      <table className="w-full text-sm">
        <thead className="bg-surface-2 text-ink-muted">
          <tr>
            <th className="px-3 py-2 text-left w-10">#</th>
            <th className="px-3 py-2 text-left">Product</th>
            {showCategory && <th className="px-3 py-2 text-left">Category</th>}
            <th className="px-3 py-2 text-right">Units</th>
            <th className="px-3 py-2 text-right">Revenue</th>
            {verbose && cost && <th className="px-3 py-2 text-right">COGS</th>}
            {cost && <th className="px-3 py-2 text-right">Gross profit</th>}
            {verbose && cost && <th className="px-3 py-2 text-right">Margin</th>}
            {verbose && cost && <th className="px-3 py-2 text-right">Card fees</th>}
            {verbose && cost && <th className="px-3 py-2 text-right">Contribution</th>}
            {verbose && <th className="px-3 py-2 text-right">Returns</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={`${r.rank}-${r.product_id}-${r.variant_id}`} className="border-t border-border">
              <td className="px-3 py-2">
                <RankBadge rank={r.rank} />
              </td>
              <td className="px-3 py-2">
                {r.product_id ? (
                  <Link
                    href={linkTo(r)}
                    className="font-medium text-ink hover:text-accent"
                  >
                    {r.product_name}
                  </Link>
                ) : (
                  <span className="font-medium text-ink">{r.product_name}</span>
                )}
                {r.sku ? (
                  <div className="text-xs text-ink-muted">SKU {r.sku}</div>
                ) : r.variant_count > 1 ? (
                  <div className="text-xs text-ink-muted">{r.variant_count} variants</div>
                ) : null}
                {Number(r.missing_cost_qty) > 0 && (
                  <div className="mt-0.5 text-xs text-amber-700">
                    No cost on {formatQty(r.missing_cost_qty)} sold, so profit is overstated
                  </div>
                )}
              </td>
              {showCategory && (
                <td className="px-3 py-2 text-ink-muted text-xs">
                  {r.category_name || '—'}
                </td>
              )}
              <td className="px-3 py-2 text-right">{formatQty(r.units_sold)}</td>
              <td className="px-3 py-2 text-right">
                <span className="inline-flex items-center rounded-full bg-accent-light px-2 py-0.5 text-xs font-semibold text-accent">
                  {formatCurrency(r.revenue)}
                </span>
              </td>
              {verbose && cost && (
                <td className="px-3 py-2 text-right text-ink-muted">{formatCurrency(r.cost_total)}</td>
              )}
              {cost && (
                <td
                  className={cn(
                    'px-3 py-2 text-right font-semibold',
                    Number(r.gross_profit) < 0 ? 'text-error' : 'text-ink',
                  )}
                >
                  {formatCurrency(r.gross_profit)}
                </td>
              )}
              {verbose && cost && (
                <td className="px-3 py-2 text-right">
                  <span
                    className={cn(
                      'inline-flex items-center rounded-full px-2 py-0.5 text-xs',
                      Number(r.margin_pct) >= 30
                        ? 'bg-success-light text-success'
                        : Number(r.margin_pct) >= 10
                          ? 'bg-amber-100 text-amber-700'
                          : 'bg-error-light text-error',
                    )}
                  >
                    {Number(r.margin_pct || 0).toFixed(1)}%
                  </span>
                </td>
              )}
              {verbose && cost && (
                <td className="px-3 py-2 text-right text-ink-muted">{formatCurrency(r.payment_fees || 0)}</td>
              )}
              {verbose && cost && (
                <td
                  className={cn(
                    'px-3 py-2 text-right',
                    Number(r.contribution_profit) < 0 ? 'text-error' : 'text-ink',
                  )}
                >
                  {formatCurrency(r.contribution_profit ?? r.gross_profit)}
                </td>
              )}
              {verbose && (
                <td className="px-3 py-2 text-right text-xs text-ink-muted">
                  {Number(r.return_rate_pct || 0).toFixed(1)}%
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
