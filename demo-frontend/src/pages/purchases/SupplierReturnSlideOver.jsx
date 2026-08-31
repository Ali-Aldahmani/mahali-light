import { useEffect, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import SlideOver from '../../components/ui/SlideOver.jsx';
import Button from '../../components/ui/Button.jsx';
import Select from '../../components/ui/Select.jsx';
import { toast } from '../../store/toastStore.js';
import { createSupplierReturn } from '../../services/supplierReturnService.js';
import { formatQty } from '../../utils/format.js';
import { fileUrl } from '../../config.js';

const REASONS = [
  { value: 'defective', label: 'Defective' },
  { value: 'wrong_item', label: 'Wrong item' },
  { value: 'excess_stock', label: 'Excess stock' },
  { value: 'expired', label: 'Expired' },
];

const CONDITIONS = [
  { value: 'defective', label: 'Defective' },
  { value: 'damaged', label: 'Damaged' },
  { value: 'good', label: 'Good' },
];

export default function SupplierReturnSlideOver({ open, onClose, po, onCreated }) {
  const [reason, setReason] = useState('defective');
  const [items, setItems] = useState([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open && po) {
      // Pre-populate with one row per received line, but qty=0 by default.
      setItems(
        po.items
          .filter((it) => Number(it.quantityReceived || 0) > 0)
          .map((it) => ({
            productId: it.productId,
            variantId: it.variantId,
            productName: it.productName,
            productImage: it.productImage,
            sku: it.sku,
            unitLabel: it.unitLabel,
            unitCost: Number(it.costPricePerUnit || 0),
            quantity: 0,
            condition: 'defective',
            serialNumber: '',
          })),
      );
    } else {
      setItems([]);
    }
  }, [open, po]);

  function patch(idx, p) {
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, ...p } : it)));
  }

  function remove(idx) {
    setItems((prev) => prev.filter((_, i) => i !== idx));
  }

  async function submit() {
    const payload = items.filter((i) => Number(i.quantity) > 0);
    if (!payload.length) {
      toast.error('Choose at least one item with quantity > 0.');
      return;
    }
    setSaving(true);
    try {
      const created = await createSupplierReturn({
        supplierId: po.supplierId,
        purchaseOrderId: po.id,
        reason,
        items: payload.map((it) => ({
          productId: it.productId,
          variantId: it.variantId,
          quantity: Number(it.quantity),
          unitCost: Number(it.unitCost),
          condition: it.condition || null,
          serialNumber: it.serialNumber || null,
        })),
      });
      toast.success(`Return ${created.returnNumber} created.`);
      onCreated?.(created);
      onClose?.();
    } catch (err) {
      toast.error(err?.message || 'Failed to create return.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <SlideOver
      open={open}
      onClose={onClose}
      title="Return to supplier"
      subtitle={po ? `From PO ${po.poNumber}` : ''}
      width="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={submit} loading={saving}>
            Create return
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div>
          <label className="text-sm font-medium text-ink mb-1.5 block">Reason</label>
          <Select
            value={reason}
            onChange={setReason}
            options={REASONS}
            searchable={false}
          />
        </div>

        {items.length === 0 ? (
          <div className="rounded-card border border-dashed border-border bg-surface-2 p-8 text-center text-sm text-ink-muted">
            <Plus className="mx-auto mb-2 h-5 w-5" />
            No received lines available for return.
          </div>
        ) : (
          <div className="space-y-2">
            {items.map((it, idx) => (
              <div
                key={`${it.variantId}-${idx}`}
                className="flex items-center gap-3 rounded-card border border-border bg-surface p-3"
              >
                <div className="h-10 w-10 rounded bg-surface-2 overflow-hidden flex items-center justify-center text-xs text-ink-muted shrink-0">
                  {it.productImage ? (
                    <img
                      src={fileUrl(it.productImage)}
                      alt=""
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    '—'
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-ink truncate">
                    {it.productName}
                  </div>
                  <div className="text-xs text-ink-muted truncate">
                    SKU: {it.sku} · Cost {formatQty(it.unitCost)} / {it.unitLabel || ''}
                  </div>
                </div>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  value={it.quantity}
                  onChange={(e) => patch(idx, { quantity: Number(e.target.value) })}
                  placeholder="Qty"
                  className="w-20 h-9 rounded-input border border-border bg-surface px-2 text-right text-sm focus:border-accent focus:outline-none"
                />
                <Select
                  value={it.condition}
                  onChange={(v) => patch(idx, { condition: v })}
                  options={CONDITIONS}
                  searchable={false}
                  className="w-32"
                />
                <button
                  type="button"
                  onClick={() => remove(idx)}
                  className="inline-flex h-7 w-7 items-center justify-center rounded-md text-error hover:bg-error-light"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </SlideOver>
  );
}
