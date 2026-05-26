import { formatCurrency } from '../../utils/format.js';

// Reusable totals block used in the cart, the confirm-pay modal, and the
// invoice detail page. Renders subtotal → discount → taxable → VAT → total
// with optional amount paid / balance due footer.
export default function InvoiceTotalsBlock({
  subtotal,
  itemDiscount = 0,
  invoiceDiscount = 0,
  discount,
  taxable,
  taxRate = 5,
  tax,
  total,
  amountPaid,
  balanceDue,
  size = 'md',
  showPayments = false,
}) {
  const totalDiscount = discount != null ? Number(discount) : Number(itemDiscount || 0) + Number(invoiceDiscount || 0);
  const sizes = {
    sm: { row: 'text-sm', total: 'text-lg' },
    md: { row: 'text-sm', total: 'text-xl' },
    lg: { row: 'text-base', total: 'text-2xl' },
  };
  const s = sizes[size] || sizes.md;
  return (
    <div className={`space-y-1.5 ${s.row}`}>
      <Row label="Subtotal" value={formatCurrency(subtotal || 0)} />
      {totalDiscount > 0 && (
        <Row
          label="Discount"
          value={`- ${formatCurrency(totalDiscount)}`}
          tone="success"
        />
      )}
      <Row label="Taxable" value={formatCurrency(taxable || 0)} />
      <Row
        label={`VAT (${Number(taxRate).toFixed(0)}%)`}
        value={formatCurrency(tax || 0)}
      />
      <div className="border-t border-border pt-2 mt-2 flex items-center justify-between">
        <span className="font-semibold text-ink">Total</span>
        <span className={`font-semibold text-ink ${s.total}`}>
          {formatCurrency(total || 0)}
        </span>
      </div>
      {showPayments && (
        <div className="mt-2 space-y-1 border-t border-border pt-2">
          <Row label="Amount paid" value={formatCurrency(amountPaid || 0)} />
          <Row
            label="Balance due"
            value={formatCurrency(balanceDue || 0)}
            tone={Number(balanceDue || 0) > 0 ? 'accent' : 'success'}
          />
        </div>
      )}
    </div>
  );
}

function Row({ label, value, tone = 'default' }) {
  const TONES = {
    default: 'text-ink',
    success: 'text-success',
    accent: 'text-accent',
  };
  return (
    <div className="flex items-center justify-between">
      <span className="text-ink-muted">{label}</span>
      <span className={TONES[tone]}>{value}</span>
    </div>
  );
}
