import { useEffect, useMemo, useState } from 'react';
import SlideOver from '../../components/ui/SlideOver.jsx';
import Button from '../../components/ui/Button.jsx';
import { toast } from '../../store/toastStore.js';
import { receivePurchaseOrderItems } from '../../services/purchaseOrderService.js';
import { formatQty } from '../../utils/format.js';
import { fileUrl } from '../../config.js';

// Slide-over that lets a user receive (full or partial) the remaining quantity
// for each PO line. Defaults to the full remaining qty for convenience.
export default function ReceiveItemsSlideOver({ open, onClose, po, onReceived }) {
  const remaining = useMemo(() => {
    if (!po) return [];
    return po.items
      .filter((it) => Number(it.quantityRemaining) > 0.0001)
      .map((it) => ({
        id: it.id,
        productName: it.productName,
        productImage: it.productImage,
        sku: it.sku,
        unitLabel: it.unitLabel,
        ordered: Number(it.quantity),
        alreadyReceived: Number(it.quantityReceived || 0),
        remaining: Number(it.quantityRemaining),
        receive: Number(it.quantityRemaining),
      }));
  }, [po]);

  const [items, setItems] = useState([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) setItems(remaining);
  }, [open, remaining]);

  function patch(idx, val) {
    setItems((prev) =>
      prev.map((it, i) =>
        i === idx ? { ...it, receive: clamp(val, 0, it.remaining) } : it,
      ),
    );
  }

  async function submit() {
    const payload = items
      .filter((it) => Number(it.receive) > 0)
      .map((it) => ({ id: it.id, quantityReceived: Number(it.receive) }));
    if (!payload.length) {
      toast.error('Enter at least one quantity to receive.');
      return;
    }
    setSaving(true);
    try {
      const updated = await receivePurchaseOrderItems(po.id, payload);
      toast.success('Stock updated. Movements logged.');
      onReceived?.(updated);
      onClose?.();
    } catch (err) {
      toast.error(err?.message || 'Failed to receive items.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <SlideOver
      open={open}
      onClose={onClose}
      title={`Receive items · ${po?.poNumber || ''}`}
      subtitle="Confirm received quantities. Stock movements are written automatically."
      width="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={submit} loading={saving}>
            Receive
          </Button>
        </>
      }
    >
      {items.length === 0 ? (
        <div className="rounded-card border border-border bg-surface-2 p-8 text-center text-sm text-ink-muted">
          Everything on this PO has already been received.
        </div>
      ) : (
        <div className="space-y-3">
          {items.map((it, idx) => (
            <div
              key={it.id}
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
                  SKU: {it.sku} · Ordered {formatQty(it.ordered)} · Already received{' '}
                  {formatQty(it.alreadyReceived)} ·{' '}
                  <span className="text-accent">
                    Remaining {formatQty(it.remaining)}
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <input
                  type="number"
                  step="0.01"
                  min={0}
                  max={it.remaining}
                  value={it.receive}
                  onChange={(e) => patch(idx, Number(e.target.value))}
                  className="w-24 h-9 rounded-input border border-border bg-surface px-2 text-right text-sm focus:border-accent focus:outline-none"
                />
                <span className="text-xs text-ink-muted">{it.unitLabel}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </SlideOver>
  );
}

function clamp(n, min, max) {
  if (!Number.isFinite(n)) return 0;
  return Math.max(min, Math.min(max, n));
}
