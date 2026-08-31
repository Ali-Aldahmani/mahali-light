import { Package } from 'lucide-react';
import Badge from '../ui/Badge.jsx';
import { fileUrl } from '../../config.js';
import { formatCurrency } from '../../utils/format.js';

function stockTone(qty) {
  if (qty <= 0) return { tone: 'error', label: 'Out' };
  if (qty <= 5) return { tone: 'warning', label: `${qty} left` };
  return { tone: 'success', label: 'In stock' };
}

// Tile for the POS product browser grid. Renders dimmed and non-clickable
// when out of stock. The component itself doesn't drive variant selection —
// the parent decides whether to add the variant directly or open the variant
// selector (used when the product has multiple variants and the cashier
// hasn't picked one yet).
export default function POSProductCard({ variant, onClick }) {
  const stock = Number(variant.stockQty || 0);
  const out = stock <= 0;
  const status = stockTone(stock);

  const attrPills = (variant.attributes || []).slice(0, 3);

  return (
    <button
      type="button"
      onClick={out ? undefined : () => onClick?.(variant)}
      className={[
        'group text-left rounded-card border border-border bg-surface shadow-card p-3 transition',
        out
          ? 'opacity-50 cursor-not-allowed'
          : 'hover:border-accent hover:shadow-pop',
      ].join(' ')}
      disabled={out}
    >
      <div className="aspect-square w-full rounded-md bg-surface-2 mb-2 overflow-hidden flex items-center justify-center">
        {variant.imagePath ? (
          <img
            src={fileUrl(variant.imagePath)}
            alt={variant.productName}
            className="h-full w-full object-cover"
          />
        ) : (
          <Package className="h-8 w-8 text-ink-muted" />
        )}
      </div>
      <div className="flex items-start justify-between gap-1.5">
        <div className="min-w-0">
          <div className="text-sm font-medium text-ink line-clamp-2">
            {variant.productName}
          </div>
          {variant.sku && (
            <div className="text-[11px] text-ink-muted mt-0.5 truncate">
              {variant.sku}
            </div>
          )}
        </div>
        <Badge tone={status.tone} size="sm">
          {status.label}
        </Badge>
      </div>
      {attrPills.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-2">
          {attrPills.map((a, i) => (
            <span
              key={i}
              className="inline-flex items-center rounded-full bg-surface-2 px-2 py-0.5 text-[10px] text-ink-muted"
            >
              {a.value}
              {a.unit || ''}
            </span>
          ))}
        </div>
      )}
      <div className="mt-2 flex items-baseline justify-between">
        <div className="text-base font-semibold text-accent">
          {formatCurrency(variant.sellingPrice || 0)}
        </div>
        <div className="text-[11px] text-ink-muted">
          per {variant.unitLabel || 'pcs'}
        </div>
      </div>
    </button>
  );
}
