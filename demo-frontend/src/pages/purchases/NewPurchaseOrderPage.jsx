import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft,
  Check,
  Plus,
  Trash2,
} from 'lucide-react';
import PageHeader from '../../components/ui/PageHeader.jsx';
import Button from '../../components/ui/Button.jsx';
import Input from '../../components/ui/Input.jsx';
import SupplierSelect from '../../components/ui/SupplierSelect.jsx';
import VariantSearchInput from '../../components/ui/VariantSearchInput.jsx';
import POItemsTable from '../../components/ui/POItemsTable.jsx';
import { toast } from '../../store/toastStore.js';
import {
  createPurchaseOrder,
  confirmPurchaseOrder,
} from '../../services/purchaseOrderService.js';
import { getSupplier } from '../../services/supplierService.js';
import { formatCurrency } from '../../utils/format.js';

const STEPS = [
  { id: 1, label: 'Order info' },
  { id: 2, label: 'Items' },
  { id: 3, label: 'Review' },
];

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

export default function NewPurchaseOrderPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const presetSupplierId = params.get('supplierId');

  const [step, setStep] = useState(1);
  const [supplier, setSupplier] = useState(null);
  const [orderDate, setOrderDate] = useState(todayISO());
  const [expectedDate, setExpectedDate] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [taxAmount, setTaxAmount] = useState(0);
  const [notes, setNotes] = useState('');
  const [items, setItems] = useState([]);
  const [saving, setSaving] = useState(false);

  // If a supplierId is passed in, fetch + preselect.
  useEffect(() => {
    if (presetSupplierId && !supplier) {
      getSupplier(presetSupplierId)
        .then((s) => setSupplier(s))
        .catch(() => {});
    }
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

  function addItem(variant) {
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

  function patchItem(idx, patch) {
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  }

  function removeItem(idx) {
    setItems((prev) => prev.filter((_, i) => i !== idx));
  }

  async function save(asDraft) {
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
    setSaving(true);
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
      }

      toast.success(
        asDraft ? 'PO saved as draft.' : `PO ${created.poNumber} confirmed.`,
      );
      navigate(`/purchase-orders/${created.id}`);
    } catch (err) {
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
        onClick={() => navigate('/purchase-orders')}
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
          <SupplierSelect
            label="Supplier"
            required
            value={supplier}
            onChange={setSupplier}
          />
          <div className="grid grid-cols-3 gap-3">
            <Input
              label="Order date"
              type="date"
              value={orderDate}
              onChange={(e) => setOrderDate(e.target.value)}
              required
            />
            <Input
              label="Expected delivery"
              type="date"
              value={expectedDate}
              onChange={(e) => setExpectedDate(e.target.value)}
            />
            <Input
              label="Payment due date"
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
            />
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
            <Button
              disabled={!canGoToStep2}
              onClick={() => setStep(2)}
            >
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
              {items.length} item{items.length === 1 ? '' : 's'} · Subtotal {' '}
              <span className="font-medium text-ink">{formatCurrency(subtotal)}</span>
            </div>
          </div>

          <VariantSearchInput
            label="Find product"
            placeholder="Search by name, SKU, barcode or attributes"
            onSelect={addItem}
          />

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
              Search for a product above to add it as a PO line.
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
              onChange={(e) => setTaxAmount(e.target.value)}
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

          <div className="flex items-center justify-between">
            <Button variant="secondary" onClick={() => setStep(2)} disabled={saving}>
              Back
            </Button>
            <div className="flex items-center gap-2">
              <Button
                variant="secondary"
                onClick={() => save(true)}
                loading={saving}
                leftIcon={<Trash2 className="h-4 w-4 opacity-0" />}
              >
                Save as draft
              </Button>
              <Button
                onClick={() => save(false)}
                loading={saving}
                leftIcon={<Check className="h-4 w-4" />}
              >
                Confirm order
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Stepper({ step }) {
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
            {idx < STEPS.length - 1 && (
              <div className="w-10 h-px bg-border mx-2" />
            )}
          </div>
        );
      })}
    </div>
  );
}

function Field({ label, value, cols = 1 }) {
  return (
    <div className={cols === 2 ? 'col-span-2' : ''}>
      <div className="text-xs text-ink-muted">{label}</div>
      <div className="text-sm text-ink">{value || '—'}</div>
    </div>
  );
}
