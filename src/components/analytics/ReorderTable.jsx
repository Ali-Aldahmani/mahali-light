import { Zap, Info } from 'lucide-react';
import { cn } from '../../utils/cn.js';
import { formatQty } from '../../utils/format.js';

const CONFIDENCE_STYLES = {
  high: 'bg-success-light text-success',
  medium: 'bg-amber-100 text-amber-700',
  low: 'bg-surface-2 text-ink-muted',
};

// Reorder recommendation table. Shows current stock vs reorder point, the
// recommended order qty, lead time, and a confidence badge so buyers know
// how much to trust the row.
export default function ReorderTable({
  rows = [],
  emptyText = 'No reorder recommendations yet.',
  onDismiss = null,
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
            <th className="px-3 py-2 text-left">Product</th>
            <th className="px-3 py-2 text-right">Stock</th>
            <th className="px-3 py-2 text-right">Reorder pt.</th>
            <th className="px-3 py-2 text-right">Recommended</th>
            <th className="px-3 py-2 text-right">Lead time</th>
            <th className="px-3 py-2 text-left">Confidence</th>
            {onDismiss && <th className="px-3 py-2"> </th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const low = Number(r.current_stock) <= Number(r.reorder_point || 0);
            return (
              <tr key={r.id || r.variant_id} className={cn('border-t border-border', low && 'bg-error-light/40')}>
                <td className="px-3 py-2">
                  <div className="font-medium text-ink flex items-center gap-1">
                    {r.product_name}
                    {r.is_peak_season && (
                      <Zap className="h-4 w-4 text-accent" title="Currently in peak season" />
                    )}
                  </div>
                  <div className="text-xs text-ink-muted">
                    {r.sku && <span>SKU {r.sku} · </span>}
                    {r.category_name || 'Uncategorised'}
                  </div>
                </td>
                <td className={cn('px-3 py-2 text-right', low && 'text-error font-semibold')}>
                  {formatQty(r.current_stock)} {r.unit_label || ''}
                </td>
                <td className="px-3 py-2 text-right">{formatQty(r.reorder_point)}</td>
                <td className="px-3 py-2 text-right font-semibold text-accent">
                  {formatQty(r.recommended_qty)}
                </td>
                <td className="px-3 py-2 text-right text-xs text-ink-muted">
                  {r.lead_time_days} d
                </td>
                <td className="px-3 py-2">
                  <span
                    className={cn(
                      'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs',
                      CONFIDENCE_STYLES[r.confidence] || CONFIDENCE_STYLES.low,
                    )}
                  >
                    <Info className="h-3 w-3" />
                    {r.confidence || 'low'}
                  </span>
                  <div className="text-[10px] text-ink-muted mt-1">
                    {r.based_on_months || 0} mo history
                  </div>
                </td>
                {onDismiss && (
                  <td className="px-3 py-2 text-right">
                    <button
                      type="button"
                      onClick={() => onDismiss(r)}
                      className="text-xs text-ink-muted hover:text-ink"
                    >
                      Dismiss
                    </button>
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
