import { ArrowRight } from 'lucide-react';
import { formatQty, formatCurrency } from '../../utils/format.js';

// Visualizes before → after stock + optional value impact.
export default function StockImpactPreview({
  beforeQty,
  afterQty,
  unitLabel,
  costPrice,
  showValue = true,
  className = '',
}) {
  const diff = Number(afterQty) - Number(beforeQty);
  const positive = diff > 0;
  const valueImpact =
    costPrice != null && Number.isFinite(Number(costPrice))
      ? diff * Number(costPrice)
      : null;

  return (
    <div
      className={`rounded-xl border border-border bg-surface-2 p-4 flex flex-col gap-2 ${className}`}
    >
      <div className="flex items-center gap-3">
        <div className="flex flex-col">
          <span className="text-xs text-ink-muted">Current</span>
          <span className="text-lg font-semibold text-ink">
            {formatQty(beforeQty)}
            {unitLabel ? ` ${unitLabel}` : ''}
          </span>
        </div>
        <ArrowRight className="h-5 w-5 text-ink-muted shrink-0" />
        <div className="flex flex-col">
          <span className="text-xs text-ink-muted">After</span>
          <span className="text-lg font-semibold text-ink">
            {formatQty(afterQty)}
            {unitLabel ? ` ${unitLabel}` : ''}
          </span>
        </div>
        <div className="ml-auto text-right">
          <div className="text-xs text-ink-muted">Change</div>
          <div
            className={
              positive
                ? 'text-success font-semibold'
                : diff < 0
                  ? 'text-error font-semibold'
                  : 'text-ink-muted font-semibold'
            }
          >
            {positive ? '+' : ''}
            {formatQty(diff)}
            {unitLabel ? ` ${unitLabel}` : ''}
          </div>
        </div>
      </div>
      {showValue && valueImpact !== null && (
        <div className="flex items-center justify-between text-sm pt-2 border-t border-border">
          <span className="text-ink-muted">Inventory value impact</span>
          <span
            className={
              valueImpact > 0
                ? 'text-success font-medium'
                : valueImpact < 0
                  ? 'text-error font-medium'
                  : 'text-ink-muted font-medium'
            }
          >
            {valueImpact > 0 ? '+' : ''}
            {formatCurrency(valueImpact)}
          </span>
        </div>
      )}
    </div>
  );
}
