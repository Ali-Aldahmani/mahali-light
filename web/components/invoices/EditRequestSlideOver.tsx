'use client';

import { useEffect, useState } from 'react';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import SlideOver from '@/components/ui/SlideOver';
import { toast } from '@/store/toastStore';
import { createEditRequest } from '@/services/invoiceEditRequestService';

/**
 * Request a change to a confirmed invoice (quantities, prices, discounts).
 * A manager approves it before anything is applied.
 */
export default function EditRequestSlideOver({
  open,
  onClose,
  invoice,
  items,
  onSubmitted,
}: {
  open: boolean;
  onClose: () => void;
  invoice: any;
  items: any[];
  onSubmitted: () => void;
}) {
  const [note, setNote] = useState('');
  const [draftItems, setDraftItems] = useState<any[]>([]);
  const [invoiceDiscount, setInvoiceDiscount] = useState<any>(0);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setNote('');
      setDraftItems(
        items.map((it) => ({
          variant_id: it.variantId,
          productName: it.productName,
          unit_label: it.unitLabel,
          quantity: Number(it.quantity),
          unit_price: Number(it.unitPrice),
          discount_amount: Number(it.discountAmount || 0),
        })),
      );
      setInvoiceDiscount(Number(invoice.invoiceDiscount || 0));
      setSaving(false);
    }
  }, [open, items, invoice]);

  async function submit() {
    if (!note.trim()) {
      toast.warning('Add a note explaining the edit.');
      return;
    }
    const changes: any = {};
    const itemChanges = draftItems
      .filter((it) => {
        const original = items.find((o) => o.variantId === it.variant_id);
        if (!original) return true;
        if (Number(original.quantity) !== Number(it.quantity)) return true;
        if (Number(original.unitPrice) !== Number(it.unit_price)) return true;
        if (Number(original.discountAmount || 0) !== Number(it.discount_amount || 0)) return true;
        return false;
      })
      .map((it) => ({
        variant_id: it.variant_id,
        quantity: Number(it.quantity),
        unit_price: Number(it.unit_price),
        discount_amount: Number(it.discount_amount || 0),
      }));
    if (itemChanges.length) changes.items = itemChanges;
    if (Number(invoiceDiscount) !== Number(invoice.invoiceDiscount || 0)) {
      changes.invoiceDiscount = Number(invoiceDiscount);
    }
    if (!Object.keys(changes).length) {
      toast.warning('Nothing changed — adjust at least one value.');
      return;
    }

    setSaving(true);
    try {
      await createEditRequest(invoice.id, {
        requestNote: note.trim(),
        changes,
      });
      toast.success('Edit request submitted.');
      onSubmitted?.();
    } catch (err: any) {
      toast.error(err?.message || 'Could not submit edit request.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <SlideOver
      open={open}
      onClose={onClose}
      title="Request invoice edit"
      subtitle="Manager approval is required before any change is applied."
      width="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={submit} loading={saving}>
            Submit request
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Input
          label="Why is this edit needed?"
          required
          value={note}
          onChange={(e: any) => setNote(e.target.value)}
          placeholder="e.g. Customer returned 1 unit on Section B"
        />

        <div>
          <div className="text-sm font-medium text-ink mb-2">Items</div>
          <ul className="space-y-2">
            {draftItems.map((it, i) => (
              <li
                key={it.variant_id}
                className="rounded-input border border-border bg-surface p-2.5 space-y-1"
              >
                <div className="text-sm text-ink">{it.productName}</div>
                <div className="grid grid-cols-3 gap-2">
                  <NumField
                    label="Qty"
                    value={it.quantity}
                    onChange={(v: any) =>
                      setDraftItems((arr) =>
                        arr.map((x, j) =>
                          j === i ? { ...x, quantity: v } : x,
                        ),
                      )
                    }
                  />
                  <NumField
                    label="Unit price"
                    value={it.unit_price}
                    onChange={(v: any) =>
                      setDraftItems((arr) =>
                        arr.map((x, j) =>
                          j === i ? { ...x, unit_price: v } : x,
                        ),
                      )
                    }
                  />
                  <NumField
                    label="Discount"
                    value={it.discount_amount}
                    onChange={(v: any) =>
                      setDraftItems((arr) =>
                        arr.map((x, j) =>
                          j === i ? { ...x, discount_amount: v } : x,
                        ),
                      )
                    }
                  />
                </div>
              </li>
            ))}
          </ul>
        </div>

        <NumField
          label="Invoice-level discount (AED)"
          value={invoiceDiscount}
          onChange={setInvoiceDiscount}
        />
      </div>
    </SlideOver>
  );
}

function NumField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: any;
  onChange: (v: any) => void;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-[11px] text-ink-muted">{label}</label>
      <input
        type="number"
        min={0}
        step="0.01"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-9 rounded-input border border-border bg-surface px-2 text-sm text-ink outline-none focus:border-accent focus:ring-1 focus:ring-accent/20"
      />
    </div>
  );
}
