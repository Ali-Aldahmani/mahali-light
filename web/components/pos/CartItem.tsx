import { ShieldAlert, Trash2 } from 'lucide-react';
import CartBatchPicker from '@/components/pos/CartBatchPicker';
import Input from '../ui/Input';
import { formatCurrency } from '@/lib/utils/format';
import NumberField from '../ui/number-field/NumberField';
import AnimatedNumber from '../ui/animated-number/AnimatedNumber';

// Single cart line item with qty stepper, discount toggle (% or AED), and
// remove. Discount toggle is local — the global posStore stores either
// discountPercent or discountAmount (whichever was last set). The "soldBy"
// hint comes from the variant; meter / kg products allow decimal qty.
export default function CartItem({
  item,
  maxQty,
  onQtyChange,
  onUnitPriceChange,
  onDiscountChange,
  onRemove,
}: {
  item: any;
  /** Units available. The stepper stops here; undefined means no limit. */
  maxQty?: number;
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
  const restrictionParts = restriction
    ? [
        restriction.minPrice != null && `Min price AED ${Number(restriction.minPrice).toFixed(2)}`,
        restriction.maxDiscountPercent != null && `Max discount ${restriction.maxDiscountPercent}%`,
        restriction.maxDiscountAmount != null &&
          `Max discount AED ${Number(restriction.maxDiscountAmount).toFixed(2)}/unit`,
      ].filter(Boolean)
    : [];
  const restrictionHint = restrictionParts.length ? restrictionParts.join(' · ') : null;
  const maxDiscountPercentHint = restriction?.maxDiscountPercent ?? undefined;
  const maxDiscountAmountHint = restriction?.maxDiscountAmount ?? undefined;
  // The steppers stop at these. A discount can never exceed the line itself;
  // a restriction lowers the cap further. maxDiscountAmountHint is a PER-UNIT
  // cap (see restrictionHint's "/unit" label above) while the AED field holds
  // the discount for the WHOLE line, so it is scaled by quantity.
  const maxPercent = Math.min(100, maxDiscountPercentHint != null ? Number(maxDiscountPercentHint) : 100);
  const maxAmount =
    maxDiscountAmountHint != null
      ? Math.min(lineSubtotal, round2(Number(maxDiscountAmountHint) * (Number(item.quantity) || 1)))
      : lineSubtotal;

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
          {isDecimal ? (
            <input
              type="number"
              min={0.01}
              max={maxQty != null && Number.isFinite(maxQty) ? maxQty : undefined}
              step="0.01"
              value={item.quantity}
              onChange={(e) => onQtyChange(e.target.value)}
              aria-label={`Quantity of ${item.productName}`}
              className="h-7 w-16 rounded-input border border-border bg-surface px-2 text-sm text-ink text-center focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/20"
            />
          ) : (
            <NumberField
              size="sm"
              hideLabel
              label={`Quantity of ${item.productName}`}
              min={1}
              max={maxQty != null && Number.isFinite(maxQty) ? Math.max(1, maxQty) : undefined}
              limitHint={(edge, limit) => (edge === 'max' ? `Only ${limit} in stock` : `At least ${limit}`)}
              value={Number(item.quantity) || 1}
              onValueChange={(n) => onQtyChange(n)}
            />
          )}
          <span className="text-[11px] text-ink-muted ml-1">
            × {formatCurrency(item.unitPrice)}
          </span>
        </div>
        <div className="text-sm font-semibold text-ink">
          <AnimatedNumber value={lineTotal} />
        </div>
      </div>

      {/* Line discount: a percent or an AED amount. Setting one clears the
          other in posStore. Typed values keep cent precision; each − / +
          press moves a whole unit. */}
      <div className="flex flex-wrap items-center gap-1.5">
        <NumberField
          size="sm"
          hideLabel
          label={`Discount percent for ${item.productName}`}
          min={0}
          max={maxPercent}
          step={0.01}
          buttonStep={1}
          formatOptions={{ minimumFractionDigits: 0, maximumFractionDigits: 2 }}
          suffix="%"
          limitHint={(edge, limit) => (edge === 'max' ? `Max discount ${limit}%` : 'No less than 0%')}
          value={Number(item.discountPercent) || 0}
          onValueChange={(n) => onDiscountChange({ percent: n })}
        />
        <span className="text-[11px] text-ink-muted">or</span>
        <NumberField
          size="sm"
          width={164}
          hideLabel
          label={`Discount amount in AED for ${item.productName}`}
          min={0}
          max={maxAmount}
          step={0.01}
          buttonStep={1}
          prefix={'AED '}
          limitHint={(edge, limit) =>
            edge === 'max' ? `Max discount AED ${limit.toFixed(2)}` : 'No less than AED 0.00'
          }
          value={Number(item.discountAmount) || 0}
          onValueChange={(n) => onDiscountChange({ amount: n })}
        />
      </div>

      {restrictionHint && (
        <div className="text-[10px] text-warning flex items-center gap-1">
          <ShieldAlert className="h-2.5 w-2.5 shrink-0" />
          {restrictionHint}
        </div>
      )}

      {!item.isCustom && <CartBatchPicker line={item} />}
    </div>
  );
}
