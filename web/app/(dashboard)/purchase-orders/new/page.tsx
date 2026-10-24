'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft, Check, Plus, Trash2 } from 'lucide-react';
import PageHeader from '@/components/ui/PageHeader';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import SupplierSelect from '@/components/ui/SupplierSelect';
import VariantSearchInput from '@/components/ui/VariantSearchInput';
import POItemsTable from '@/components/ui/POItemsTable';
import RequirePermission from '@/components/guards/RequirePermission';
import PermissionGate from '@/components/ui/PermissionGate';
import QuickAddSupplierModal from '@/components/purchases/QuickAddSupplierModal';
import QuickAddProductModal from '@/components/pos/QuickAddProductModal';
import ReceiptUpload from '@/components/ui/ReceiptUpload';
import { toast } from '@/store/toastStore';
import {
  createPurchaseOrder,
  confirmPurchaseOrder,
  getPurchaseOrder,
  receivePurchaseOrderItems,
  uploadPurchaseOrderAttachment,
} from '@/services/purchaseOrderService';
import { addPoPayment } from '@/services/supplierPaymentService';
import { getSupplier } from '@/services/supplierService';
import { useAuthStore } from '@/store/authStore';
import { formatCurrency, formatQty, storeDate } from '@/lib/utils/format';
import type { POItem, VariantSearchResult } from '@/components/purchases/types';
import { newPoSavedMessage } from '@/lib/purchases/newPoMessage';
import type { Supplier } from '@/components/suppliers/types';
import DateField from '@/components/ui/DateField';

const STEPS = [
  { id: 1, label: 'Order info' },
  { id: 2, label: 'Items' },
  { id: 3, label: 'Review' },
];

function todayISO() {
  return storeDate();
}

interface DraftItem extends POItem {
  productId: number;
  variantId: number;
  productName: string;
  productImage?: string | null;
  sku?: string;
  barcode?: string | null;
  unitLabel?: string | null;
  quantity: number | string;
  costPricePerUnit: number | string;
}

function money2(n: number) {
  return Math.round(n * 100) / 100;
}

function NewPurchaseOrderPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const presetSupplierId = searchParams.get('supplierId');
  const canPay = useAuthStore((s) => (s.permissions || []).includes('supplier.purchase_order.pay'));

  const [step, setStep] = useState(1);
  const [supplier, setSupplier] = useState<Supplier | null>(null);
  const [orderDate, setOrderDate] = useState(todayISO());
  const [expectedDate, setExpectedDate] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [taxAmount, setTaxAmount] = useState<number | string>(0);
  const [notes, setNotes] = useState('');
  const [items, setItems] = useState<DraftItem[]>([]);
  const [saving, setSaving] = useState(false);
  const [addSupplierOpen, setAddSupplierOpen] = useState(false);
  const [addProductOpen, setAddProductOpen] = useState(false);
  const [markReceived, setMarkReceived] = useState(false);
  const [allItemsReceived, setAllItemsReceived] = useState<'yes' | 'no' | null>(null);
  const [receiveByVariant, setReceiveByVariant] = useState<Record<string, number>>({});
  const [invoiceFile, setInvoiceFile] = useState<File | null>(null);
  const [recordPayment, setRecordPayment] = useState(false);
  const [payKind, setPayKind] = useState<'full' | 'half' | 'custom'>('full');
  const [payAmount, setPayAmount] = useState<number | string>('');
  const [payMethod, setPayMethod] = useState<'cash' | 'bank_transfer' | 'cheque'>('cash');

  // If a supplierId is passed in, fetch + preselect.
  useEffect(() => {
    if (presetSupplierId && !supplier) {
      getSupplier(presetSupplierId)
        .then((s: Supplier) => setSupplier(s))
        .catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [presetSupplierId, supplier]);

  const subtotal = useMemo(
    () =>
      items.reduce(
        (s, it) =>
          s + Number(it.quantity || 0) * Number(it.costPricePerUnit || 0),
        0,
      ),
    [items],
  );
  const total = subtotal + Number(taxAmount || 0);

  // Step-1 → step-2 guard.
  const canGoToStep2 = !!supplier;
  const canGoToStep3 =
    items.length > 0 &&
    items.every(
      (it) => Number(it.quantity) > 0 && Number(it.costPricePerUnit) >= 0,
    );

  function addItem(variant: VariantSearchResult) {
    if (!variant) return;
    if (items.some((i) => i.variantId === variant.variantId)) {
      toast.info('Item already added — adjust the quantity instead.');
      return;
    }
    setItems((prev) => [
      ...prev,
      {
        productId: variant.productId,
        variantId: variant.variantId,
        productName: variant.productName,
        productImage: variant.imagePath,
        sku: variant.sku,
        barcode: variant.barcode || variant.internalBarcode,
        unitLabel: variant.unitLabel,
        quantity: 1,
        costPricePerUnit: variant.costPrice ?? 0,
      },
    ]);
  }

  function patchItem(idx: number, patch: Partial<DraftItem>) {
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  }

  function removeItem(idx: number) {
    setItems((prev) => prev.filter((_, i) => i !== idx));
  }

  function setReceived(next: boolean) {
    setMarkReceived(next);
    if (!next) {
      setAllItemsReceived(null);
      setInvoiceFile(null);
    }
  }

  useEffect(() => {
    if (allItemsReceived !== 'no') return;
    setReceiveByVariant((prev) => {
      const next: Record<string, number> = {};
      for (const it of items) {
        const key = String(it.variantId);
        next[key] = prev[key] != null ? prev[key] : Number(it.quantity || 0);
      }
      return next;
    });
  }, [allItemsReceived, items]);

  async function save(asDraft: boolean) {
    if (!supplier) {
      toast.error('Choose a supplier first.');
      setStep(1);
      return;
    }
    if (!items.length) {
      toast.error('Add at least one item.');
      setStep(2);
      return;
    }
    if (!asDraft && markReceived && !allItemsReceived) {
      toast.error('Choose whether all items were received.');
      return;
    }
    if (!asDraft && markReceived && allItemsReceived === 'no') {
      const anyReceived = items.some(
        (it) => Number(receiveByVariant[String(it.variantId)] || 0) > 0,
      );
      if (!anyReceived) {
        toast.error('Enter how many of each item you received, or mark all items received.');
        return;
      }
    }
    const plannedPay =
      payKind === 'full'
        ? money2(total)
        : payKind === 'half'
          ? money2(total / 2)
          : money2(Number(payAmount));
    if (!asDraft && recordPayment) {
      if (!Number.isFinite(plannedPay) || plannedPay <= 0) {
        toast.error('Enter a payment amount greater than zero.');
        return;
      }
      if (plannedPay > total + 0.001) {
        toast.error('Payment cannot exceed the order total.');
        return;
      }
    }
    setSaving(true);
    // Set only once the payment call has actually succeeded.
    let paymentRecorded = false;
    try {
      const created = await createPurchaseOrder({
        supplierId: supplier.id,
        orderDate,
        expectedDate: expectedDate || null,
        dueDate: dueDate || null,
        taxAmount: Number(taxAmount || 0),
        notes: notes || null,
        items: items.map((it) => ({
          productId: it.productId,
          variantId: it.variantId,
          quantity: Number(it.quantity),
          unitLabel: it.unitLabel || null,
          costPricePerUnit: Number(it.costPricePerUnit),
        })),
      });

      if (!asDraft) {
        await confirmPurchaseOrder(created.id);
        if (markReceived) {
          const full = await getPurchaseOrder(created.id);
          const receivePayload = (full.items || [])
            .map((it: any) => {
              const ordered = Number(it.quantity);
              const qty =
                allItemsReceived === 'yes'
                  ? ordered
                  : Math.min(
                      ordered,
                      Number(receiveByVariant[String(it.variantId)] || 0),
                    );
              if (!(qty > 0)) return null;
              return { id: it.id, quantityReceived: qty };
            })
            .filter(Boolean);
          if (receivePayload.length) {
            await receivePurchaseOrderItems(created.id, receivePayload);
          }
          if (invoiceFile) {
            try {
              await uploadPurchaseOrderAttachment(created.id, invoiceFile);
            } catch (_e) {
              toast.warning('Order received, but the supplier invoice failed to upload.');
            }
          }
        }
        if (recordPayment) {
          try {
            const latest = await getPurchaseOrder(created.id);
            const balance = Number(latest.balanceDue ?? total);
            const amt =
              payKind === 'full'
                ? money2(balance)
                : payKind === 'half'
                  ? money2(balance / 2)
                  : Math.min(money2(Number(payAmount)), money2(balance));
            if (amt > 0) {
              await addPoPayment(created.id, {
                amount: amt,
                paymentMethod: payMethod,
                paymentDate: todayISO(),
                notes: null,
              });
              paymentRecorded = true;
            }
          } catch (_e) {
            toast.warning('Order saved, but the payment could not be recorded.');
          }
        }
      }

      toast.success(
        newPoSavedMessage({
          asDraft,
          poNumber: created.poNumber,
          received: markReceived,
          paymentRecorded,
        }),
      );
      router.push(`/purchase-orders/${created.id}`);
    } catch (err: any) {
      toast.error(err?.message || 'Failed to save purchase order.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-5">
      <Button
        variant="ghost"
        size="sm"
        leftIcon={<ArrowLeft className="h-4 w-4" />}
        onClick={() => router.push('/purchase-orders')}
      >
        All purchase orders
      </Button>

      <PageHeader
        title="New purchase order"
        subtitle="Capture supplier, items, and totals before confirming."
      />

      <Stepper step={step} />

      {step === 1 && (
        <div className="card p-5 space-y-4 max-w-3xl">
          <h2 className="text-sm font-semibold text-ink">Order info</h2>
          <div className="flex items-end gap-2">
            <div className="min-w-0 flex-1">
              <SupplierSelect
                label="Supplier"
                required
                value={supplier}
                onChange={setSupplier}
              />
            </div>
            <PermissionGate permission="supplier.create">
              <Button
                variant="secondary"
                leftIcon={<Plus className="h-4 w-4" />}
                onClick={() => setAddSupplierOpen(true)}
              >
                Add new supplier
              </Button>
            </PermissionGate>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <DateField label="Order date" value={orderDate} onChange={setOrderDate} required />
            <DateField label="Expected delivery" value={expectedDate} onChange={setExpectedDate} min={orderDate || undefined} />
            <DateField label="Payment due date" value={dueDate} onChange={setDueDate} min={orderDate || undefined} />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-ink">Notes</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              className="w-full rounded-input border border-border bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-muted focus:border-accent focus:ring-2 focus:ring-accent/20 focus:outline-none"
              placeholder="Anything special about this order"
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button disabled={!canGoToStep2} onClick={() => setStep(2)}>
              Continue
            </Button>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="card p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-ink">Add items</h2>
            <div className="text-sm text-ink-muted">
              {items.length} item{items.length === 1 ? '' : 's'} · Subtotal{' '}
              <span className="font-medium text-ink">{formatCurrency(subtotal)}</span>
            </div>
          </div>

          <div className="flex items-end gap-2">
            <div className="min-w-0 flex-1">
              <VariantSearchInput
                label="Find product"
                placeholder="Search by name, SKU, barcode or attributes"
                onSelect={addItem}
              />
            </div>
            <PermissionGate permission="product.create">
              <Button
                variant="secondary"
                leftIcon={<Plus className="h-4 w-4" />}
                onClick={() => setAddProductOpen(true)}
              >
                Add new product
              </Button>
            </PermissionGate>
          </div>

          {items.length > 0 ? (
            <POItemsTable
              items={items}
              editable
              onChange={patchItem}
              onRemove={removeItem}
            />
          ) : (
            <div className="rounded-card border border-dashed border-border bg-surface-2 p-8 text-center text-sm text-ink-muted">
              <Plus className="mx-auto mb-2 h-5 w-5 text-ink-muted" />
              Search for a product above, or add a new one, to create a PO line.
            </div>
          )}

          <div className="grid grid-cols-3 gap-3 pt-2">
            <div className="col-span-2" />
            <Input
              label="Tax / shipping amount"
              type="number"
              step="0.01"
              min={0}
              value={taxAmount}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setTaxAmount(e.target.value)}
            />
          </div>

          <div className="flex justify-between pt-2">
            <Button variant="secondary" onClick={() => setStep(1)}>
              Back
            </Button>
            <Button disabled={!canGoToStep3} onClick={() => setStep(3)}>
              Review order
            </Button>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="space-y-4">
          <div className="card p-5 space-y-2">
            <h2 className="text-sm font-semibold text-ink">Review</h2>
            <div className="grid grid-cols-2 gap-2 text-sm text-ink">
              <Field label="Supplier" value={supplier?.name} />
              <Field label="Order date" value={orderDate} />
              <Field label="Expected delivery" value={expectedDate || '—'} />
              <Field label="Payment due" value={dueDate || '—'} />
              {notes && <Field label="Notes" value={notes} cols={2} />}
            </div>
          </div>

          <div className="card p-5">
            <h3 className="text-sm font-semibold text-ink mb-3">Items</h3>
            <POItemsTable items={items} editable={false} />
            <div className="flex justify-end mt-4 text-sm space-y-1">
              <div className="space-y-1 text-right">
                <div className="text-ink-muted">
                  Subtotal:{' '}
                  <span className="text-ink font-medium ml-2">
                    {formatCurrency(subtotal)}
                  </span>
                </div>
                <div className="text-ink-muted">
                  Tax / shipping:{' '}
                  <span className="text-ink font-medium ml-2">
                    {formatCurrency(taxAmount)}
                  </span>
                </div>
                <div className="text-base text-ink font-semibold">
                  Total: {formatCurrency(total)}
                </div>
              </div>
            </div>
          </div>

          <div className="card p-5 space-y-4">
            <h3 className="text-sm font-semibold text-ink">Receiving</h3>
            <label className="flex items-start gap-3 text-sm text-ink cursor-pointer select-none">
              <input
                type="checkbox"
                className="mt-0.5 rounded border-border text-accent focus:ring-accent"
                checked={markReceived}
                onChange={(e) => setReceived(e.target.checked)}
              />
              <span>
                <span className="font-medium">Mark this purchase order as received</span>
                <span className="block text-ink-muted">
                  Use this when the goods have already arrived from the supplier. Stock is updated when you confirm.
                </span>
              </span>
            </label>

            {markReceived && (
              <div className="space-y-4 rounded-card border border-border bg-surface-2 p-4">
                <fieldset className="space-y-2">
                  <legend className="text-sm font-medium text-ink">
                    Were all items received?
                  </legend>
                  <label className="flex items-center gap-2 text-sm text-ink cursor-pointer">
                    <input
                      type="radio"
                      name="all-items-received"
                      className="text-accent focus:ring-accent"
                      checked={allItemsReceived === 'yes'}
                      onChange={() => setAllItemsReceived('yes')}
                    />
                    Yes — receive the full ordered quantity for every line
                  </label>
                  <label className="flex items-center gap-2 text-sm text-ink cursor-pointer">
                    <input
                      type="radio"
                      name="all-items-received"
                      className="text-accent focus:ring-accent"
                      checked={allItemsReceived === 'no'}
                      onChange={() => setAllItemsReceived('no')}
                    />
                    No — I will enter how many arrived
                  </label>
                </fieldset>

                {allItemsReceived === 'no' && (
                  <div className="space-y-2">
                    <div className="text-xs font-medium text-ink-muted uppercase tracking-wide">
                      Quantity received
                    </div>
                    {items.map((it) => {
                      const key = String(it.variantId);
                      const ordered = Number(it.quantity || 0);
                      return (
                        <div
                          key={key}
                          className="flex items-center gap-3 rounded-input border border-border bg-surface px-3 py-2"
                        >
                          <div className="min-w-0 flex-1">
                            <div className="text-sm font-medium text-ink truncate">
                              {it.productName}
                            </div>
                            <div className="text-xs text-ink-muted">
                              Ordered {formatQty(ordered)} {it.unitLabel || 'pcs'}
                            </div>
                          </div>
                          <input
                            type="number"
                            min={0}
                            max={ordered}
                            step="0.01"
                            value={receiveByVariant[key] ?? ''}
                            onChange={(e) => {
                              const raw = Number(e.target.value);
                              const qty = Number.isFinite(raw)
                                ? Math.max(0, Math.min(ordered, raw))
                                : 0;
                              setReceiveByVariant((prev) => ({ ...prev, [key]: qty }));
                            }}
                            className="w-24 h-9 rounded-input border border-border bg-surface px-2 text-right text-sm focus:border-accent focus:outline-none"
                            aria-label={`Received quantity for ${it.productName}`}
                          />
                        </div>
                      );
                    })}
                  </div>
                )}

                <div>
                  <div className="text-sm font-medium text-ink mb-1.5">
                    Supplier invoice
                  </div>
                  <ReceiptUpload
                    buttonLabel="Upload buying invoice"
                    hint="Optional. PDF, JPG or PNG · max 5 MB"
                    onSelect={setInvoiceFile}
                    onClear={() => setInvoiceFile(null)}
                  />
                </div>
              </div>
            )}
          </div>

          {canPay && (
            <div className="card p-5 space-y-4">
              <h3 className="text-sm font-semibold text-ink">Payment</h3>
              <label className="flex items-start gap-3 text-sm text-ink cursor-pointer select-none">
                <input
                  type="checkbox"
                  className="mt-0.5 rounded border-border text-accent focus:ring-accent"
                  checked={recordPayment}
                  onChange={(e) => {
                    const on = e.target.checked;
                    setRecordPayment(on);
                    if (on && (payAmount === '' || payAmount == null)) {
                      setPayAmount(money2(total));
                    }
                  }}
                />
                <span>
                  <span className="font-medium">Record a payment now</span>
                  <span className="block text-ink-muted">
                    Pay the full total, half, or a specific amount. You can add more later from the PO.
                  </span>
                </span>
              </label>

              {recordPayment && (
                <div className="space-y-4 rounded-card border border-border bg-surface-2 p-4">
                  <div>
                    <div className="text-sm font-medium text-ink mb-1.5">How much to pay</div>
                    <div className="grid grid-cols-3 gap-2">
                      {(
                        [
                          { id: 'full' as const, label: 'Paid in full', amount: money2(total) },
                          { id: 'half' as const, label: 'Half', amount: money2(total / 2) },
                          { id: 'custom' as const, label: 'Specific amount', amount: null },
                        ]
                      ).map((opt) => (
                        <button
                          type="button"
                          key={opt.id}
                          onClick={() => {
                            setPayKind(opt.id);
                            if (opt.amount != null) setPayAmount(opt.amount);
                          }}
                          className={[
                            'rounded-input border px-2 py-2 text-sm text-center transition',
                            payKind === opt.id
                              ? 'border-accent bg-accent-light text-accent'
                              : 'border-border bg-surface text-ink hover:bg-surface-2',
                          ].join(' ')}
                        >
                          <div className="font-medium">{opt.label}</div>
                          {opt.amount != null && (
                            <div className="text-xs mt-0.5 opacity-80">
                              {formatCurrency(opt.amount)}
                            </div>
                          )}
                        </button>
                      ))}
                    </div>
                  </div>
                  <Input
                    label="Amount"
                    type="number"
                    min={0}
                    step="0.01"
                    max={total}
                    value={
                      payKind === 'full'
                        ? money2(total)
                        : payKind === 'half'
                          ? money2(total / 2)
                          : payAmount
                    }
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                      setPayKind('custom');
                      setPayAmount(e.target.value);
                    }}
                    required
                  />
                  <div>
                    <div className="text-sm font-medium text-ink mb-1.5">Payment method</div>
                    <div className="grid grid-cols-3 gap-2">
                      {(
                        [
                          { id: 'cash' as const, label: 'Cash' },
                          { id: 'bank_transfer' as const, label: 'Bank transfer' },
                          { id: 'cheque' as const, label: 'Cheque' },
                        ]
                      ).map((m) => (
                        <button
                          type="button"
                          key={m.id}
                          onClick={() => setPayMethod(m.id)}
                          className={[
                            'rounded-input border px-3 py-2 text-sm text-center transition',
                            payMethod === m.id
                              ? 'border-accent bg-accent-light text-accent'
                              : 'border-border bg-surface text-ink hover:bg-surface-2',
                          ].join(' ')}
                        >
                          {m.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="flex items-center justify-between">
            <Button variant="secondary" onClick={() => setStep(2)} disabled={saving}>
              Back
            </Button>
            <div className="flex items-center gap-2">
              <Button
                variant="secondary"
                onClick={() => save(true)}
                loading={saving}
                disabled={markReceived || recordPayment}
                title={
                  markReceived || recordPayment
                    ? 'Uncheck received or payment to save a draft. Those steps require a confirmed order.'
                    : undefined
                }
                leftIcon={<Trash2 className="h-4 w-4 opacity-0" />}
              >
                Save as draft
              </Button>
              <Button
                onClick={() => save(false)}
                loading={saving}
                leftIcon={<Check className="h-4 w-4" />}
              >
                {recordPayment && markReceived
                  ? 'Confirm, receive & pay'
                  : recordPayment
                    ? 'Confirm & pay'
                    : markReceived
                      ? 'Confirm & receive'
                      : 'Confirm order'}
              </Button>
            </div>
          </div>
        </div>
      )}

      <QuickAddSupplierModal
        open={addSupplierOpen}
        onClose={() => setAddSupplierOpen(false)}
        onCreated={(created) => {
          setSupplier(created);
          setAddSupplierOpen(false);
        }}
      />
      <QuickAddProductModal
        open={addProductOpen}
        onClose={() => setAddProductOpen(false)}
        addToOrderEvenIfZeroStock
        addToOrderLabel="Add to this purchase order"
        submitAddLabel="Save & add to order"
        onAddToCart={(variant) => addItem(variant)}
      />
    </div>
  );
}

function Stepper({ step }: { step: number }) {
  return (
    <div className="flex items-center gap-2">
      {STEPS.map((s, idx) => {
        const done = step > s.id;
        const active = step === s.id;
        return (
          <div key={s.id} className="flex items-center gap-2">
            <div
              className={[
                'h-7 w-7 rounded-full inline-flex items-center justify-center text-xs font-medium',
                done
                  ? 'bg-success text-white'
                  : active
                    ? 'bg-accent text-white'
                    : 'bg-surface-2 text-ink-muted',
              ].join(' ')}
            >
              {done ? <Check size={14} /> : s.id}
            </div>
            <div
              className={[
                'text-sm',
                active ? 'text-ink font-medium' : 'text-ink-muted',
              ].join(' ')}
            >
              {s.label}
            </div>
            {idx < STEPS.length - 1 && <div className="w-10 h-px bg-border mx-2" />}
          </div>
        );
      })}
    </div>
  );
}

function Field({
  label,
  value,
  cols = 1,
}: {
  label: string;
  value?: string | null;
  cols?: number;
}) {
  return (
    <div className={cols === 2 ? 'col-span-2' : ''}>
      <div className="text-xs text-ink-muted">{label}</div>
      <div className="text-sm text-ink">{value || '—'}</div>
    </div>
  );
}

export default function NewPurchaseOrderPage() {
  return (
    <RequirePermission permission="supplier.purchase_order.create">
      <NewPurchaseOrderPageContent />
    </RequirePermission>
  );
}
