import { ArrowRight, ArrowDown, ArrowUp } from 'lucide-react';
import { formatCurrency } from '../../utils/format.js';

// Calculates difference between original returned items and replacement items
// and renders the customer's net position. Pure presentational.
export default function PriceDiffCalculator({
  originalValue = 0,
  replacementValue = 0,
  className = '',
}) {
  const diff = Math.round((replacementValue - originalValue) * 100) / 100;
  const direction =
    diff > 0 ? 'customer_pays' : diff < 0 ? 'refund_to_customer' : 'none';

  return (
    <div
      className={`rounded-xl border border-border bg-surface p-4 ${className}`}
    >
      <div className="text-[11px] uppercase tracking-wide text-ink-muted">
        Replacement comparison
      </div>
      <div className="mt-2 flex items-center justify-between gap-3">
        <div>
          <div className="text-xs text-ink-muted">Original</div>
          <div className="text-lg font-semibold text-ink">
            {formatCurrency(originalValue)}
          </div>
        </div>
        <ArrowRight className="h-4 w-4 text-ink-muted" />
        <div>
          <div className="text-xs text-ink-muted">Replacement</div>
          <div className="text-lg font-semibold text-ink">
            {formatCurrency(replacementValue)}
          </div>
        </div>
      </div>
      <div
        className={`mt-3 flex items-center justify-between rounded-lg p-3 text-sm ${
          direction === 'customer_pays'
            ? 'bg-accent-light text-accent'
            : direction === 'refund_to_customer'
              ? 'bg-warning-light text-warning'
              : 'bg-success-light text-success'
        }`}
      >
        <span className="font-medium">
          {direction === 'customer_pays' && (
            <span className="inline-flex items-center gap-1">
              <ArrowUp className="h-4 w-4" /> Customer pays difference
            </span>
          )}
          {direction === 'refund_to_customer' && (
            <span className="inline-flex items-center gap-1">
              <ArrowDown className="h-4 w-4" /> Refund to customer
            </span>
          )}
          {direction === 'none' && <span>Even exchange</span>}
        </span>
        <span className="font-semibold">{formatCurrency(Math.abs(diff))}</span>
      </div>
    </div>
  );
}
