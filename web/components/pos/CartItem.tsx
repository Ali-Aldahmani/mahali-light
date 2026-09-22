import { Minus, Percent, Plus, ShieldAlert, Trash2 } from 'lucide-react';
import Input from '../ui/Input';
import { formatCurrency } from '@/lib/utils/format';

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
}: {
  item: any;
  onQtyChange: (qty: number | string) => void;
  onUnitPriceChange?: (price: number) => void;
  onDiscountChange: (patch: { percent?: number; amount?: number }) => void;
  onRemove: () => void;
}) {
  const isDecimal = item.soldBy && item.soldBy !== 'piece';
  // Mirrors posStore's computeLineTotal (and the backend's
  // computeLineFigures) exactly: round the subtotal to 2dp BEFORE deriving
  // a percent-based discount from it, not after. Rounding only at the end
  // (the previous behavior here) can disagree by a cent with the cart-level
  // total and the confirmed invoice for decimal-quantity lines, e.g.
  // qty 2.5 x unitPrice 3.33 with a 10% discount: subtotal-first-rounding
  // gives 8.33 -> 0.83 discount -> 7.50, but discounting the raw 8.325
  // gives 0.8325 -> 7.4925 -> displays 7.49.
  const round2 = (n: number) => Math.round(n * 100 + 1e-9) / 100;
  const lineSubtotal = round2(Number(item.quantity) * Number(item.unitPrice));
  let discount = round2(Number(item.discountAmount) || 0);
  if (!discount && Number(item.discountPercent) > 0) {
    discount = round2(lineSubtotal * (Number(item.discountPercent) / 100));
  }
  const lineTotal = Math.max(0, round2(lineSubtotal - discount));

  // UX-only reflection of a pricing restriction — the server is what
  // actually enforces it (invoiceService), this just avoids a round trip
  // for the common case of a cashier typing an obviously-too-big discount.
  const restriction = item.pricingRestriction;
  const restrictionHint = restriction
    ? restriction.restrictionType === 'MINIMUM_PRICE'
      ? `Min price AED ${Number(restriction.minPrice).toFixed(2)}`
      : restriction.restrictionType === 'MAX_DISCOUNT_PERCENT'
        ? `Max discount ${restriction.maxDiscountPercent}%`
        : `Max discount AED ${Number(restriction.maxDiscountAmount).toFixed(2)}/unit`
    : null;
  const maxDiscountPercentHint =
    restriction?.restrictionType === 'MAX_DISCOUNT_PERCENT' ? restriction.maxDiscountPercent : undefined;
  const maxDiscountAmountHint =
    restriction?.restrictionType === 'MAX_DISCOUNT_AMOUNT' ? restriction.maxDiscountAmount : undefined;

  // Compact 2-line layout — POS cart is space-constrained.
  return (
    <div className="rounded-input border border-border bg-surface p-2.5 space-y-1.5">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium text-ink truncate flex items-center gap-1.5">
            {item.productName}
            {item.isCustom && (
              <span className="shrink-0 rounded-full bg-warning-light text-warning text-[10px] font-medium px-1.5 py-0.5">
                {item.thirdPartyName ? `Third-party · ${item.thirdPartyName}` : 'Custom'}
              </span>
            )}
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
            × {formatCurrency(item.unitPrice)}
          </span>
        </div>
        <div className="text-sm font-semibold text-ink">
          {formatCurrency(lineTotal)}
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
            max={maxDiscountPercentHint}
            step="1"
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
            AED
          </span>
          <input
            type="number"
            min={0}
            // maxDiscountAmountHint is a PER-UNIT cap (see restrictionHint's
            // "/unit" label above); this field holds the discount for the
            // WHOLE line, so the hint must be scaled by quantity or it
            // under-caps any multi-unit line.
            max={
              maxDiscountAmountHint != null
                ? maxDiscountAmountHint * (Number(item.quantity) || 1)
                : undefined
            }
            step="1"
            value={item.discountAmount || ''}
            onChange={(e) =>
              onDiscountChange({ amount: Number(e.target.value) })
            }
            placeholder="0.00"
            className="h-7 w-16 text-xs text-ink text-right px-1.5 bg-transparent outline-none border-l border-border"
          />
        </div>
      </div>

      {restrictionHint && (
        <div className="text-[10px] text-warning flex items-center gap-1">
          <ShieldAlert className="h-2.5 w-2.5 shrink-0" />
          {restrictionHint}
        </div>
      )}
    </div>
  );
}
