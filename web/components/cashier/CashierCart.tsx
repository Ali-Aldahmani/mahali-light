'use client';

import { memo, useEffect, useRef } from 'react';
import { AlertTriangle, ShoppingCart, Trash2, User, UserRound, X } from 'lucide-react';
import InvoiceTotalsBlock from '@/components/ui/InvoiceTotalsBlock';
import SerialNumberInput from '@/components/ui/SerialNumberInput';
import { formatCurrency } from '@/lib/utils/format';
import { cn } from '@/lib/utils/cn';
import type { PriceViolation } from '@/lib/cashier/pricing';
import NumberField from '@/components/ui/number-field/NumberField';

export interface CashierCartProps {
  lines: any[];
  totals: any;
  customer: any | null;
  draftInvoiceNumber: string | null;
  selectedId: string | number | null;
  pendingRemoveId: string | number | null;
  violations: Map<string | number, PriceViolation[]>;
  canDiscount: boolean;
  invoiceDiscount: number;
  lastScan: { tone: 'ok' | 'error'; text: string } | null;
  paying: boolean;
  payBlockedReason: string | null;
  onSelect: (id: string | number) => void;
  onQtyChange: (id: string | number, qty: number) => void;
  onRequestRemove: (id: string | number) => void;
  onDiscountChange: (id: string | number, patch: { percent?: number; amount?: number }) => void;
  onInvoiceDiscountChange: (amount: number) => void;
  onSerialChange: (id: string | number, value: string, status: { valid?: boolean; error?: string | null }) => void;
  onCustomerClick: () => void;
  onClearCustomer: () => void;
  onPay: () => void;
}

export default function CashierCart(props: CashierCartProps) {
  const {
    lines,
    totals,
    customer,
    draftInvoiceNumber,
    selectedId,
    violations,
    lastScan,
    paying,
    payBlockedReason,
    canDiscount,
    invoiceDiscount,
  } = props;
  const listRef = useRef<HTMLUListElement>(null);

  // Keep the selected line visible when moving with ↑/↓ or after a scan.
  useEffect(() => {
    if (selectedId == null || !listRef.current) return;
    const key = String(selectedId).replace(/["\\]/g, '\\$&');
    const el = listRef.current.querySelector(`[data-line-id="${key}"]`);
    (el as HTMLElement | null)?.scrollIntoView?.({ block: 'nearest' });
  }, [selectedId, lines.length]);

  const itemCount = lines.reduce((s, l) => s + Number(l.quantity || 0), 0);
  const isGuest = !customer?.id;

  return (
    <aside
      aria-label="Current sale"
      className="flex min-h-0 w-full shrink-0 flex-col border-l border-border bg-surface md:w-[400px] xl:w-[440px]"
    >
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
        <button
          type="button"
          onClick={props.onCustomerClick}
          className="flex h-12 min-w-0 flex-1 items-center gap-2 rounded-input border border-border px-3 text-left hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          aria-label={isGuest ? 'Choose customer (currently guest)' : `Customer ${customer.name}. Change customer`}
        >
          {isGuest ? (
            <UserRound className="h-5 w-5 shrink-0 text-ink-muted" aria-hidden />
          ) : (
            <User className="h-5 w-5 shrink-0 text-accent" aria-hidden />
          )}
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium text-ink">
              {isGuest ? 'Guest customer' : customer.name}
            </span>
            <span className="block truncate text-[11px] text-ink-muted">
              {isGuest ? 'Tap to select or add a customer' : customer.phone || 'Registered customer'}
            </span>
          </span>
          <kbd className="hidden shrink-0 rounded border border-border px-1.5 text-[10px] text-ink-muted lg:inline">F6</kbd>
        </button>
        {!isGuest && (
          <button
            type="button"
            onClick={props.onClearCustomer}
            className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-input text-ink-muted hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            aria-label="Remove customer from sale"
          >
            <X className="h-5 w-5" />
          </button>
        )}
      </div>

      <div className="flex shrink-0 items-center justify-between px-3 pt-2 text-xs text-ink-muted">
        <span>
          {lines.length ? `${lines.length} line${lines.length === 1 ? '' : 's'} · ${itemCount} item${itemCount === 1 ? '' : 's'}` : 'No items'}
        </span>
        {draftInvoiceNumber && (
          <span className="rounded-full bg-warning-light px-2 py-0.5 font-medium text-warning">
            Draft · {draftInvoiceNumber}
          </span>
        )}
      </div>

      <div aria-live="polite" className="min-h-[1.75rem] shrink-0 px-3 pt-1">
        {lastScan && (
          <p className={cn('truncate text-xs font-medium', lastScan.tone === 'ok' ? 'text-success' : 'text-error')}>
            {lastScan.text}
          </p>
        )}
      </div>

      {lines.length === 0 ? (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-6 text-center text-ink-muted">
          <ShoppingCart className="h-10 w-10" aria-hidden />
          <p className="mt-2 text-sm">Cart is empty. Scan or tap a product.</p>
        </div>
      ) : (
        <ul ref={listRef} className="min-h-0 flex-1 space-y-2 overflow-y-auto px-3 pb-2" aria-label="Cart items">
          {lines.map((line) => (
            <CartLine
              key={line.variantId}
              line={line}
              selected={selectedId === line.variantId}
              pendingRemove={props.pendingRemoveId === line.variantId}
              violations={violations.get(line.variantId) || null}
              canDiscount={canDiscount}
              onSelect={props.onSelect}
              onQtyChange={props.onQtyChange}
              onRequestRemove={props.onRequestRemove}
              onDiscountChange={props.onDiscountChange}
              onSerialChange={props.onSerialChange}
            />
          ))}
        </ul>
      )}

      <div className="shrink-0 space-y-3 border-t border-border px-3 py-3">
        {canDiscount && lines.length > 0 && (
          <label className="flex items-center justify-between gap-3 text-sm">
            <span className="text-ink-muted">Invoice discount (AED)</span>
            <input
              type="number"
              inputMode="decimal"
              min={0}
              step="0.01"
              value={invoiceDiscount || ''}
              placeholder="0.00"
              onChange={(e) => props.onInvoiceDiscountChange(Math.max(0, Number(e.target.value) || 0))}
              className="h-11 w-28 rounded-input border border-border px-2 text-right text-ink focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30"
            />
          </label>
        )}
        <InvoiceTotalsBlock
          subtotal={totals.subtotal}
          itemDiscount={totals.itemDiscount}
          invoiceDiscount={totals.invoiceDiscount}
          taxable={totals.taxable}
          taxRate={totals.taxRate}
          tax={totals.tax}
          total={totals.total}
          size="md"
        />
        {payBlockedReason && lines.length > 0 && (
          <p role="alert" className="flex items-start gap-1.5 text-xs font-medium text-error">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
            {payBlockedReason}
          </p>
        )}
        <button
          type="button"
          onClick={props.onPay}
          disabled={!lines.length || !!payBlockedReason || paying}
          className={cn(
            'flex h-16 w-full items-center justify-center gap-3 rounded-card bg-success text-lg font-bold text-white shadow-card',
            'touch-manipulation hover:bg-green-700 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-success/40',
            'disabled:cursor-not-allowed disabled:bg-success/40',
          )}
        >
          <span>PAY {formatCurrency(totals.total)}</span>
          <kbd className="rounded bg-white/20 px-1.5 py-0.5 text-xs font-medium">F4</kbd>
        </button>
      </div>
    </aside>
  );
}

const CartLine = memo(function CartLine({
  line,
  selected,
  pendingRemove,
  violations,
  canDiscount,
  onSelect,
  onQtyChange,
  onRequestRemove,
  onDiscountChange,
  onSerialChange,
}: {
  line: any;
  selected: boolean;
  pendingRemove: boolean;
  violations: PriceViolation[] | null;
  canDiscount: boolean;
  onSelect: (id: string | number) => void;
  onQtyChange: (id: string | number, qty: number) => void;
  onRequestRemove: (id: string | number) => void;
  onDiscountChange: (id: string | number, patch: { percent?: number; amount?: number }) => void;
  onSerialChange: CashierCartProps['onSerialChange'];
}) {
  const id = line.variantId;
  const decimal = line.soldBy && line.soldBy !== 'piece';
  const step = decimal ? 0.5 : 1;
  const qty = Number(line.quantity) || 0;
  const attrs = (line.attributes || []).map((a: any) => `${a.value}${a.unit || ''}`).join(' · ');

  return (
    <li
      data-line-id={String(id)}
      aria-current={selected ? 'true' : undefined}
      onClick={() => onSelect(id)}
      className={cn(
        'rounded-input border bg-surface p-2.5',
        selected ? 'border-accent ring-2 ring-accent/30' : 'border-border',
        violations && 'border-error',
      )}
    >
      <div className="flex items-start gap-2">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onSelect(id);
          }}
          className="min-w-0 flex-1 rounded text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          aria-label={`Select ${line.productName}`}
          aria-pressed={selected}
        >
          <span className="block truncate text-sm font-medium text-ink">
            {line.productName}
            {line.isCustom && (
              <span className="ml-1.5 rounded-full bg-warning-light px-1.5 py-0.5 text-[10px] font-medium text-warning">
                {line.thirdPartyName ? `Third-party · ${line.thirdPartyName}` : 'Custom'}
              </span>
            )}
          </span>
          <span className="block truncate text-[11px] text-ink-muted">
            {formatCurrency(line.unitPrice)} / {line.unitLabel || 'pcs'}
            {attrs ? ` · ${attrs}` : ''}
          </span>
        </button>
        <span className="shrink-0 pt-0.5 text-right text-sm font-semibold text-ink">
          {formatCurrency(line.lineTotal)}
          {Number(line.lineDiscount) > 0 && (
            <span className="block text-[11px] font-normal text-success">
              −{formatCurrency(line.lineDiscount)}
            </span>
          )}
        </span>
      </div>

      <div className="mt-2 flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
        <NumberField
          size="lg"
          hideLabel
          label={`Quantity of ${line.productName}`}
          // Typed metres/kg keep cent precision; each press moves a whole step.
          min={decimal ? 0.01 : 1}
          step={decimal ? 0.01 : 1}
          buttonStep={step}
          value={qty}
          onValueChange={(n) => {
            onSelect(id);
            onQtyChange(id, n);
          }}
        />
        <span className="flex-1" />
        <button
          type="button"
          onClick={() => onRequestRemove(id)}
          className={cn(
            'inline-flex h-11 items-center justify-center gap-1 rounded-input px-3 text-sm font-medium touch-manipulation',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-error',
            pendingRemove ? 'bg-error text-white' : 'text-ink-muted hover:bg-error-light hover:text-error',
          )}
          aria-label={pendingRemove ? `Confirm removing ${line.productName}` : `Remove ${line.productName}`}
        >
          <Trash2 className="h-4 w-4" />
          {pendingRemove && <span>Tap to remove</span>}
        </button>
      </div>

      {selected && canDiscount && !line.isCustom && (
        <div className="mt-2 flex items-center gap-2 text-xs" onClick={(e) => e.stopPropagation()}>
          <label className="flex items-center gap-1">
            <span className="text-ink-muted">Disc %</span>
            <input
              type="number"
              inputMode="decimal"
              min={0}
              max={100}
              value={line.discountPercent || ''}
              placeholder="0"
              onChange={(e) => onDiscountChange(id, { percent: Math.max(0, Number(e.target.value) || 0) })}
              className="h-11 w-16 rounded-input border border-border px-2 text-right text-sm focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30"
            />
          </label>
          <label className="flex items-center gap-1">
            <span className="text-ink-muted">or AED</span>
            <input
              type="number"
              inputMode="decimal"
              min={0}
              step="0.01"
              value={line.discountAmount || ''}
              placeholder="0.00"
              onChange={(e) => onDiscountChange(id, { amount: Math.max(0, Number(e.target.value) || 0) })}
              className="h-11 w-20 rounded-input border border-border px-2 text-right text-sm focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30"
            />
          </label>
        </div>
      )}

      {line.requiresSerial && (
        <div className="mt-2" onClick={(e) => e.stopPropagation()}>
          <SerialNumberInput
            value={line.serialNumber || ''}
            productId={line.productId}
            productName={line.productName}
            required
            onChange={(value: string, status: any) => onSerialChange(id, value, status)}
          />
        </div>
      )}

      {violations && (
        <ul role="alert" className="mt-2 space-y-0.5 text-xs font-medium text-error">
          {violations.map((v) => (
            <li key={v.restrictionType} className="flex items-start gap-1">
              <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
              {v.message}
            </li>
          ))}
        </ul>
      )}
    </li>
  );
});
