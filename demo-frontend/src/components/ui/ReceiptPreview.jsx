import { formatCurrency, formatDateTime } from '../../utils/format.js';

// Narrow on-screen preview of what the 80 mm thermal receipt looks like.
// Useful in the POS success screen as a "this is what will print" thumbnail.
// Renders synchronously off cart data — no network call.
export default function ReceiptPreview({
  storeName,
  storeTRN,
  storePhone,
  invoiceNumber,
  cashierName,
  customerName,
  date = new Date(),
  items = [],
  subtotal,
  discount = 0,
  vatRate = 5,
  vatAmount,
  total,
  payments = [],
  change = 0,
  footerNote = 'Thank you!',
  width = 280,
}) {
  return (
    <div
      className="rounded-input border border-border bg-white p-3 font-mono text-[11px] leading-tight text-ink shadow-sm"
      style={{ width }}
    >
      <div className="text-center">
        <div className="text-sm font-bold">{storeName || '—'}</div>
        {storePhone && <div className="text-[10px]">{storePhone}</div>}
        {storeTRN && <div className="text-[10px]">TRN: {storeTRN}</div>}
      </div>

      <div className="my-2 border-t border-dashed border-ink-muted/50" />

      <div className="text-center">
        <div className="font-semibold">{invoiceNumber || 'DRAFT'}</div>
        <div className="text-[10px]">{formatDateTime(date)}</div>
        {cashierName && <div className="text-[10px]">Cashier: {cashierName}</div>}
        {customerName && (
          <div className="text-[10px]">Customer: {customerName}</div>
        )}
      </div>

      <div className="my-2 border-t border-dashed border-ink-muted/50" />

      <div className="space-y-1">
        {items.length === 0 ? (
          <div className="text-center text-ink-muted">No items</div>
        ) : (
          items.map((it, idx) => (
            <div key={idx}>
              <div className="flex justify-between">
                <span className="flex-1 truncate pr-2">{it.name}</span>
                <span className="font-semibold">
                  {formatCurrency(it.total)}
                </span>
              </div>
              <div className="text-[10px] text-ink-muted">
                {it.qty} {it.unit || 'pcs'} × {formatCurrency(it.unitPrice)}
                {it.discount > 0 && ` · -${formatCurrency(it.discount)}`}
              </div>
            </div>
          ))
        )}
      </div>

      <div className="my-2 border-t border-dashed border-ink-muted/50" />

      <div className="space-y-0.5">
        <Row label="Subtotal" value={formatCurrency(subtotal)} />
        {discount > 0 && (
          <Row label="Discount" value={`- ${formatCurrency(discount)}`} />
        )}
        <Row label={`VAT (${vatRate}%)`} value={formatCurrency(vatAmount)} />
        <div className="my-1 border-y border-ink py-0.5">
          <Row label="TOTAL" value={formatCurrency(total)} bold />
        </div>
      </div>

      {payments.length > 0 && (
        <>
          <div className="my-2 border-t border-dashed border-ink-muted/50" />
          <div className="space-y-0.5">
            {payments.map((p, idx) => (
              <Row
                key={idx}
                label={p.method?.toUpperCase()}
                value={formatCurrency(p.amount)}
              />
            ))}
            {change > 0 && (
              <Row label="Change" value={formatCurrency(change)} bold />
            )}
          </div>
        </>
      )}

      <div className="my-2 border-t border-dashed border-ink-muted/50" />

      <div className="text-center text-[10px]">{footerNote}</div>
      <div className="mt-2 flex justify-center">
        <div className="grid h-16 w-16 place-items-center rounded-sm bg-surface-2 text-[10px] text-ink-muted">
          QR
        </div>
      </div>
    </div>
  );
}

function Row({ label, value, bold = false }) {
  return (
    <div
      className={`flex justify-between ${bold ? 'font-bold text-[12px]' : ''}`}
    >
      <span>{label}</span>
      <span>{value}</span>
    </div>
  );
}
