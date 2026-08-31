import { useEffect, useMemo, useState } from 'react';
import SlideOver from '../../components/ui/SlideOver.jsx';
import Button from '../../components/ui/Button.jsx';
import Input from '../../components/ui/Input.jsx';
import Select from '../../components/ui/Select.jsx';
import VariantSearchInput from '../../components/ui/VariantSearchInput.jsx';
import StockImpactPreview from '../../components/ui/StockImpactPreview.jsx';
import { createAdjustment } from '../../services/adjustmentService.js';
import { useAuthStore } from '../../store/authStore.js';
import { toast } from '../../store/toastStore.js';

const REASON_OPTIONS = [
  { value: 'damaged', label: 'Damaged' },
  { value: 'lost', label: 'Lost' },
  { value: 'found', label: 'Found' },
  { value: 'counting_error', label: 'Counting error' },
  { value: 'expired', label: 'Expired' },
  { value: 'other', label: 'Other' },
];

const TYPE_OPTIONS = [
  { value: 'add', label: 'Add to stock' },
  { value: 'remove', label: 'Remove from stock' },
  { value: 'set', label: 'Set to exact value' },
];

export default function RequestAdjustmentSlideOver({
  open,
  onClose,
  onSuccess,
  initialVariant,
}) {
  const permissions = useAuthStore((s) => s.permissions);
  const canDirect = permissions.includes('stock.adjust_direct');

  const [variant, setVariant] = useState(initialVariant || null);
  const [type, setType] = useState('add');
  const [qty, setQty] = useState('');
  const [reason, setReason] = useState('damaged');
  const [note, setNote] = useState('');
  const [applyDirectly, setApplyDirectly] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (open) {
      setVariant(initialVariant || null);
      setType('add');
      setQty('');
      setReason('damaged');
      setNote('');
      setApplyDirectly(false);
      setError(null);
    }
  }, [open, initialVariant]);

  const currentQty = Number(variant?.stockQty || 0);
  const parsedQty = Number(qty);
  const isValidQty = Number.isFinite(parsedQty);

  const newQty = useMemo(() => {
    if (!variant || !isValidQty) return currentQty;
    if (type === 'add') return currentQty + Math.abs(parsedQty);
    if (type === 'remove') return currentQty - Math.abs(parsedQty);
    if (type === 'set') return parsedQty;
    return currentQty;
  }, [variant, type, parsedQty, isValidQty, currentQty]);

  const isFormValid =
    variant && isValidQty && parsedQty >= 0 && note.trim().length >= 10;

  async function handleSubmit(e) {
    e.preventDefault();
    if (!isFormValid) return;
    setSubmitting(true);
    setError(null);
    try {
      const payload = {
        variantId: variant.variantId,
        adjustmentType: type,
        quantity: parsedQty,
        reason,
        note: note.trim(),
        applyDirectly: canDirect && applyDirectly,
      };
      await createAdjustment(payload);
      toast.success(
        applyDirectly
          ? 'Stock adjusted successfully.'
          : 'Adjustment request submitted for approval.',
      );
      onSuccess?.();
      onClose?.();
    } catch (err) {
      setError(err?.message || 'Could not submit the adjustment.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <SlideOver
      open={open}
      onClose={onClose}
      width="md"
      title="Request stock adjustment"
      subtitle="Submit a request to add, remove, or correct stock levels."
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button
            type="submit"
            form="adjustment-form"
            disabled={!isFormValid || submitting}
            loading={submitting}
          >
            {applyDirectly && canDirect ? 'Apply directly' : 'Submit request'}
          </Button>
        </>
      }
    >
      <form id="adjustment-form" onSubmit={handleSubmit} className="space-y-4">
        <VariantSearchInput
          autoFocus={!initialVariant}
          defaultVariant={variant}
          onSelect={setVariant}
          label="Product"
        />

        {variant && (
          <div className="rounded-xl border border-border bg-surface-2 p-3 flex items-center justify-between">
            <span className="text-sm text-ink-muted">Current stock</span>
            <span className="text-lg font-semibold text-ink">
              {currentQty} {variant.unitLabel || ''}
            </span>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <Select
            label="Adjustment type"
            value={type}
            onChange={setType}
            options={TYPE_OPTIONS}
            searchable={false}
          />
          <Input
            label={type === 'set' ? 'New quantity' : 'Quantity'}
            type="number"
            step="0.01"
            min="0"
            value={qty}
            onChange={(e) => setQty(e.target.value)}
            placeholder="0"
          />
        </div>

        {variant && isValidQty && (
          <StockImpactPreview
            beforeQty={currentQty}
            afterQty={newQty}
            unitLabel={variant.unitLabel}
            costPrice={variant.costPrice}
          />
        )}

        <Select
          label="Reason"
          value={reason}
          onChange={setReason}
          options={REASON_OPTIONS}
          searchable={false}
        />

        <div className="space-y-1.5">
          <label className="text-sm font-medium text-ink">
            Note <span className="text-error">*</span>
          </label>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className="w-full rounded-input border border-border bg-surface px-3 py-2 text-sm text-ink focus:border-accent focus:ring-2 focus:ring-accent/20 outline-none"
            rows={3}
            placeholder="Explain why this adjustment is needed (min. 10 characters)"
          />
          <p className="text-xs text-ink-muted">
            {note.trim().length}/10 characters minimum
          </p>
        </div>

        {canDirect && (
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              checked={applyDirectly}
              onChange={(e) => setApplyDirectly(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-border text-accent focus:ring-accent/30"
            />
            <span>
              <span className="font-medium text-ink">Apply directly</span>
              <span className="block text-xs text-ink-muted">
                Skip approval and adjust the stock immediately (logged in
                activity).
              </span>
            </span>
          </label>
        )}

        {error && (
          <div className="rounded-input bg-error-light text-error px-3 py-2 text-sm">
            {error}
          </div>
        )}
      </form>
    </SlideOver>
  );
}
