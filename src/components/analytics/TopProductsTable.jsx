import { Link } from 'react-router-dom';
import { cn } from '../../utils/cn.js';
import { formatCurrency, formatQty } from '../../utils/format.js';

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

// Ranked product list. Compact = use in dashboard column. Verbose adds units,
// invoice count and a margin badge.
export default function TopProductsTable({
  rows = [],
  verbose = false,
  emptyText = 'No sales in this period.',
  showCategory = false,
  linkTo = (row) => `/products/${row.product_id}`,
}) {
  if (!rows.length) {
    return (
      <div className="rounded-card border border-border bg-surface p-6 text-center text-sm text-ink-muted">
        {emptyText}
      </div>
    );
  }
  return (
    <div className="rounded-card border border-border bg-surface overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-surface-2 text-ink-muted">
          <tr>
            <th className="px-3 py-2 text-left w-10">#</th>
            <th className="px-3 py-2 text-left">Product</th>
            {showCategory && <th className="px-3 py-2 text-left">Category</th>}
            <th className="px-3 py-2 text-right">Units</th>
            <th className="px-3 py-2 text-right">Revenue</th>
            {verbose && <th className="px-3 py-2 text-right">Margin</th>}
            {verbose && <th className="px-3 py-2 text-right">Returns</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={`${r.product_id}-${r.variant_id}`} className="border-t border-border">
              <td className="px-3 py-2">
                <RankBadge rank={r.rank} />
              </td>
              <td className="px-3 py-2">
                <Link
                  to={linkTo(r)}
                  className="font-medium text-ink hover:text-accent"
                >
                  {r.product_name}
                </Link>
                {r.sku && (
                  <div className="text-xs text-ink-muted">SKU {r.sku}</div>
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
              {verbose && (
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
