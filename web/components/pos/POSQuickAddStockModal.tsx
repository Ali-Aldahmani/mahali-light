'use client';

import { useEffect, useState } from 'react';
import Modal from '@/components/ui/Modal';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import Select from '@/components/ui/Select';
import { createAdjustment } from '@/services/adjustmentService';
import { useAuthStore } from '@/store/authStore';
import { useRequestKey } from '@/hooks/useRequestKey';
import { toast } from '@/store/toastStore';

const REASONS = [
  { value: 'other', label: 'Quick restock / Other' },
  { value: 'found', label: 'Found / Unrecorded stock' },
  { value: 'counting_error', label: 'Counting correction' },
];

export interface POSQuickAddStockModalProps {
  open: boolean;
  variant: any;
  onClose: () => void;
  onSuccess?: () => void;
}

export default function POSQuickAddStockModal({
  open,
  variant,
  onClose,
  onSuccess,
}: POSQuickAddStockModalProps) {
  const permissions = useAuthStore((s) => s.permissions);
  const canDirect = permissions.includes('stock.adjust_direct');
  const requestKey = useRequestKey(open);

  const [quantity, setQuantity] = useState('1');
  const [reason, setReason] = useState('other');
  const [note, setNote] = useState('');
  const [applyDirectly, setApplyDirectly] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (open) {
      setQuantity('1');
      setReason('other');
      setNote('');
      setApplyDirectly(canDirect);
      setError('');
    }
  }, [open, canDirect]);

  if (!variant) return null;

  async function handleSubmit() {
    const qty = Number(quantity);
    if (!Number.isFinite(qty) || qty <= 0) {
      setError('Enter a quantity greater than 0.');
      return;
    }
    setError('');
    setSaving(true);
    try {
      const cleanNote = note.trim();
      const finalNote =
        cleanNote.length >= 10
          ? cleanNote
          : cleanNote
            ? `${cleanNote} — Quick stock addition from POS`
            : 'Quick stock addition from POS';

      await createAdjustment(
        {
          variantId: variant.variantId,
          adjustmentType: 'add',
          quantity: qty,
          reason,
          note: finalNote,
          applyDirectly: canDirect ? applyDirectly : false,
        },
        requestKey.current(),
      );

      toast.success(
        canDirect && applyDirectly
          ? `Added ${qty} ${variant.unitLabel || 'pcs'} to ${variant.productName}.`
          : `Stock addition request submitted for ${variant.productName}.`,
      );
      onSuccess?.();
      onClose();
    } catch (err: any) {
      toast.error(err?.message || 'Could not add stock.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={() => !saving && onClose()}
      title="Quick add stock"
      subtitle={`Add stock for ${variant.productName}${variant.sku ? ` (${variant.sku})` : ''}`}
      size="md"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} loading={saving}>
            Add stock
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

        <Input
          label={`Quantity to add (${variant.unitLabel || 'pcs'})`}
          required
          autoFocus
          type="number"
          min={1}
          step="1"
          value={quantity}
          onChange={(e: any) => setQuantity(e.target.value)}
          error={error}
        />

        <Select
          label="Reason"
          options={REASONS}
          value={reason}
          onChange={(value: string) => setReason(value)}
        />

        <Input
          label="Note (optional)"
          value={note}
          onChange={(e: any) => setNote(e.target.value)}
          placeholder="Defaults to 'Quick stock addition from POS'"
        />

        {canDirect && (
          <label className="flex items-center gap-2 text-sm text-ink cursor-pointer select-none">
            <input
              type="checkbox"
              className="rounded border-border text-accent focus:ring-accent"
              checked={applyDirectly}
              onChange={(e) => setApplyDirectly(e.target.checked)}
            />
            Apply immediately to stock on hand
          </label>
        )}
      </div>
    </Modal>
  );
}

