import { Minus, Percent, Plus, Trash2 } from 'lucide-react';
import Input from '../ui/Input.jsx';
import Money from '../ui/Money.jsx';
import DirhamSymbol from '../ui/DirhamSymbol.jsx';

// Single cart line item with qty stepper, discount toggle (% or AED), and
// remove. Discount toggle is local — the global posStore stores either
// discountPercent or discountAmount (whichever was last set). The "soldBy"
// hint comes from the variant; meter / kg products allow decimal qty.
export default function CartItem({
  item,
  onQtyChange,
  onUnitPriceChange,
  onDiscountChange,
  onRemove,
}) {
  const isDecimal = item.soldBy && item.soldBy !== 'piece';
  const lineSubtotal = Number(item.quantity) * Number(item.unitPrice);
  const discount = item.discountAmount
    ? Number(item.discountAmount)
    : lineSubtotal * (Number(item.discountPercent || 0) / 100);
  const lineTotal = Math.max(0, lineSubtotal - discount);

  // Compact 2-line layout — POS cart is space-constrained.
  return (
    <div className="rounded-input border border-border bg-surface p-2.5 space-y-1.5">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium text-ink truncate">
            {item.productName}
          </div>
          {item.attributes?.length > 0 && (
            <div className="text-[11px] text-ink-muted truncate">
              {item.attributes
                .map((a) => `${a.value}${a.unit || ''}`)
                .join(' · ')}
            </div>
          )}
          {item.sku && (
            <div className="text-[11px] text-ink-muted">{item.sku}</div>
          )}
        </div>
        <button
          type="button"
          onClick={onRemove}
          className="inline-flex h-7 w-7 items-center justify-center rounded-full text-ink-muted hover:text-error hover:bg-surface-2"
          aria-label="Remove from cart"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          {!isDecimal && (
            <button
              type="button"
              onClick={() =>
                onQtyChange(Math.max(1, Number(item.quantity) - 1))
              }
              className="inline-flex h-7 w-7 items-center justify-center rounded-input bg-surface-2 text-ink hover:bg-accent-light hover:text-accent"
            >
              <Minus className="h-3.5 w-3.5" />
            </button>
          )}
          <input
            type="number"
            min={isDecimal ? 0.01 : 1}
            step={isDecimal ? '0.01' : '1'}
            value={item.quantity}
            onChange={(e) => onQtyChange(e.target.value)}
            className="h-7 w-16 rounded-input border border-border bg-surface px-2 text-sm text-ink text-center focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/20"
          />
          {!isDecimal && (
            <button
              type="button"
              onClick={() => onQtyChange(Number(item.quantity) + 1)}
              className="inline-flex h-7 w-7 items-center justify-center rounded-input bg-surface-2 text-ink hover:bg-accent-light hover:text-accent"
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
          )}
          <span className="text-[11px] text-ink-muted ml-1">
            × <Money value={item.unitPrice} />
          </span>
        </div>
        <div className="text-sm font-semibold text-ink">
          <Money value={lineTotal} />
        </div>
      </div>

      <div className="flex items-center gap-1.5">
        <div className="flex items-center rounded-input border border-border bg-surface overflow-hidden">
          <button
            type="button"
            onClick={() =>
              onDiscountChange({ percent: Number(item.discountPercent || 0) })
            }
            className={[
              'h-7 px-2 text-xs',
              item.discountPercent || (!item.discountPercent && !item.discountAmount)
                ? 'bg-accent-light text-accent'
                : 'text-ink-muted',
            ].join(' ')}
          >
            <Percent className="h-3 w-3" />
          </button>
          <input
            type="number"
            min={0}
            step="0.01"
            value={item.discountPercent || ''}
            onChange={(e) =>
              onDiscountChange({ percent: Number(e.target.value) })
            }
            placeholder="0"
            className="h-7 w-12 text-xs text-ink text-right px-1.5 bg-transparent outline-none border-l border-border"
          />
        </div>
        <span className="text-[11px] text-ink-muted">or</span>
        <div className="flex items-center rounded-input border border-border bg-surface overflow-hidden">
          <span className="h-7 px-2 text-xs text-ink-muted flex items-center">
            <DirhamSymbol />
          </span>
          <input
            type="number"
            min={0}
            step="0.01"
            value={item.discountAmount || ''}
            onChange={(e) =>
              onDiscountChange({ amount: Number(e.target.value) })
            }
            placeholder="0.00"
            className="h-7 w-16 text-xs text-ink text-right px-1.5 bg-transparent outline-none border-l border-border"
          />
        </div>
      </div>
    </div>
  );
}
