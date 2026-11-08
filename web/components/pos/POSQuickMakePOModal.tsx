'use client';

import { useEffect, useState } from 'react';
import { Plus } from 'lucide-react';
import Modal from '@/components/ui/Modal';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import SupplierSelect from '@/components/ui/SupplierSelect';
import QuickAddSupplierModal from '@/components/purchases/QuickAddSupplierModal';
import {
  createPurchaseOrder,
  confirmPurchaseOrder,
  getPurchaseOrder,
  receivePurchaseOrderItems,
} from '@/services/purchaseOrderService';
import { formatCurrency, storeDate } from '@/lib/utils/format';
import { useAuthStore } from '@/store/authStore';
import { useRequestKey } from '@/hooks/useRequestKey';
import { toast } from '@/store/toastStore';

export interface POSQuickMakePOModalProps {
  open: boolean;
  variant: any;
  onClose: () => void;
  onSuccess?: () => void;
}

export default function POSQuickMakePOModal({
  open,
  variant,
  onClose,
  onSuccess,
}: POSQuickMakePOModalProps) {
  const permissions = useAuthStore((s) => s.permissions);
  const canSeeCost = permissions.includes('product.view_cost');
  const canCreateSupplier = permissions.includes('supplier.create');
  const createKey = useRequestKey(open);
  const receiveKey = useRequestKey(open);

  const [supplier, setSupplier] = useState<any>(null);
  const [quantity, setQuantity] = useState('10');
  const [costPrice, setCostPrice] = useState('0');
  const [notes, setNotes] = useState('');
  const [receiveImmediately, setReceiveImmediately] = useState(true);
  const [addSupplierOpen, setAddSupplierOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (open && variant) {
      setSupplier(null);
      setQuantity('10');
      setCostPrice(String(Number(variant.costPrice ?? 0)));
      setNotes('');
      setReceiveImmediately(true);
      setErrors({});
    }
  }, [open, variant]);

  if (!variant) return null;

  const lineTotal = Math.max(0, Number(quantity || 0) * Number(costPrice || 0));

  function validate() {
    const next: Record<string, string> = {};
    if (!supplier?.id) next.supplier = 'Select a supplier.';
    const qty = Number(quantity);
    if (!Number.isFinite(qty) || qty <= 0) next.quantity = 'Enter a valid quantity.';
    const cost = Number(costPrice);
    if (!Number.isFinite(cost) || cost < 0) next.costPrice = 'Enter a valid unit cost.';
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function handleSubmit() {
    if (!validate()) return;
    setSaving(true);
    try {
      const qty = Number(quantity);
      const cost = canSeeCost ? Number(costPrice || 0) : Number(variant.costPrice || 0);
      const created = await createPurchaseOrder(
        {
          supplierId: supplier.id,
          orderDate: storeDate(),
          notes: notes.trim() || 'Quick PO created from POS',
          items: [
            {
              productId: variant.productId,
              variantId: variant.variantId,
              quantity: qty,
              unitLabel: variant.unitLabel || 'pcs',
              costPricePerUnit: cost,
            },
          ],
        },
        createKey.current(),
      );

      // These steps are separate requests. Pressing the button again after one
      // fails replays the same PO, so read where it got to instead of assuming
      // a new draft: confirming twice is refused and would block every retry.
      const full = await getPurchaseOrder(created.id);
      if (full?.status === 'draft') {
        await confirmPurchaseOrder(created.id);
      }

      if (receiveImmediately) {
        const receivePayload = (full?.items || [])
          .filter((it: any) => Number(it.quantityRemaining) > 0)
          .map((it: any) => ({
            id: it.id,
            quantityReceived: Number(it.quantityRemaining),
          }));
        if (receivePayload.length > 0) {
          await receivePurchaseOrderItems(created.id, receivePayload, receiveKey.current());
        }
        toast.success(
          `PO ${created.poNumber || ''} created & ${qty} ${variant.unitLabel || 'pcs'} received into stock.`,
        );
      } else {
        toast.success(`Purchase Order ${created.poNumber || ''} created for ${supplier.name}.`);
      }

      onSuccess?.();
      onClose();
    } catch (err: any) {
      toast.error(err?.message || 'Could not create purchase order.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <Modal
        open={open}
        onClose={() => !saving && onClose()}
        title="Quick make PO"
        subtitle={`Create a Purchase Order for ${variant.productName}${variant.sku ? ` (${variant.sku})` : ''}`}
        size="md"
        footer={
          <>
            <Button variant="secondary" onClick={onClose} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={handleSubmit} loading={saving}>
              {receiveImmediately ? 'Create PO & receive stock' : 'Create PO'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="rounded-card border border-border bg-surface-2 px-3.5 py-2.5 flex items-center justify-between">
            <div>
              <div className="text-sm font-medium text-ink">{variant.productName}</div>
              {variant.sku && <div className="text-xs text-ink-muted font-mono">{variant.sku}</div>}
            </div>
            <div className="text-right">
              <div className="text-xs text-ink-muted">Current stock</div>
              <div className="text-sm font-semibold text-ink">
                {Number(variant.stockQty || 0)} {variant.unitLabel || 'pcs'}
              </div>
            </div>
          </div>

          <div className="space-y-1.5">
            <div className="flex items-end gap-2">
              <div className="flex-1 min-w-0">
                <SupplierSelect
                  label="Supplier"
                  required
                  value={supplier}
                  onChange={(s: any) => {
                    setSupplier(s);
                    if (errors.supplier) setErrors((prev) => ({ ...prev, supplier: '' }));
                  }}
                />
              </div>
              {canCreateSupplier && (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  leftIcon={<Plus className="h-4 w-4" />}
                  onClick={() => setAddSupplierOpen(true)}
                >
                  New
                </Button>
              )}
            </div>
            {errors.supplier && <div className="text-xs text-error">{errors.supplier}</div>}
          </div>

          <div className={`grid gap-4 ${canSeeCost ? 'grid-cols-2' : 'grid-cols-1'}`}>
            <Input
              label={`Order quantity (${variant.unitLabel || 'pcs'})`}
              required
              type="number"
              min={1}
              step="1"
              value={quantity}
              onChange={(e: any) => setQuantity(e.target.value)}
              error={errors.quantity}
            />
            {canSeeCost && (
              <Input
                label="Cost price per unit (AED)"
                required
                type="number"
                min={0}
                step="0.01"
                value={costPrice}
                onChange={(e: any) => setCostPrice(e.target.value)}
                error={errors.costPrice}
              />
            )}
          </div>

          {canSeeCost && (
            <div className="flex items-center justify-between text-xs text-ink-muted px-1">
              <span>Estimated PO total</span>
              <span className="font-semibold text-ink">{formatCurrency(lineTotal)}</span>
            </div>
          )}

          <Input
            label="Notes (optional)"
            value={notes}
            onChange={(e: any) => setNotes(e.target.value)}
            placeholder="e.g. Urgent restock from POS"
          />

          <label className="flex items-center gap-2 text-sm text-ink cursor-pointer select-none">
            <input
              type="checkbox"
              className="rounded border-border text-accent focus:ring-accent"
              checked={receiveImmediately}
              onChange={(e) => setReceiveImmediately(e.target.checked)}
            />
            Confirm & receive stock immediately
          </label>
        </div>
      </Modal>

      <QuickAddSupplierModal
        open={addSupplierOpen}
        onClose={() => setAddSupplierOpen(false)}
        onCreated={(created) => setSupplier(created)}
      />
    </>
  );
}

