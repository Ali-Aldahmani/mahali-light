'use client';

import { useState } from 'react';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import { toast } from '@/store/toastStore';
import { formatDate, formatDateTime } from '@/lib/utils/format';
import { closePurchaseOrderRemainder, recordSupplierPromise } from '@/services/purchaseOrderService';
import type { PurchaseOrder } from './types';

// When the supplier said the goods would come, and when they did. Each
// promised date is kept (the first supplier date never changes), each
// delivery shows when it arrived and when it was entered, and the part that
// will never come can be closed so the order ends.
export default function DeliveryHistoryCard({
  po, canEdit, onChanged,
}: { po: PurchaseOrder; canEdit: boolean; onChanged: () => void }) {
  const [promisedDate, setPromisedDate] = useState('');
  const [note, setNote] = useState('');
  const [reason, setReason] = useState('');
  const [closing, setClosing] = useState(false);
  const [busy, setBusy] = useState(false);

  const open = ['confirmed', 'partially_received'].includes(po.status);
  const remaining = (po.items || []).reduce((s, it) => s + Number(it.quantityRemaining || 0), 0);
  const promises = po.promises || [];
  const receipts = po.receipts || [];

  async function savePromise() {
    setBusy(true);
    try {
      await recordSupplierPromise(po.id, promisedDate, note.trim() || null);
      toast.success('Supplier delivery date recorded.');
      setPromisedDate('');
      setNote('');
      onChanged();
    } catch (err: any) {
      toast.error(err?.message || 'Could not record the date.');
    } finally {
      setBusy(false);
    }
  }

  async function closeRemainder() {
    setBusy(true);
    try {
      await closePurchaseOrderRemainder(po.id, reason.trim());
      toast.success('The undelivered remainder is closed.');
      setClosing(false);
      setReason('');
      onChanged();
    } catch (err: any) {
      toast.error(err?.message || 'Could not close the remainder.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card p-5 space-y-4">
      <h2 className="text-sm font-semibold text-ink">Delivery history</h2>

      <div className="space-y-1.5 text-sm">
        <p className="text-xs font-medium uppercase tracking-wide text-ink-muted">Promised dates</p>
        {promises.length === 0 ? (
          <p className="text-xs text-ink-muted">None recorded yet.</p>
        ) : promises.map((p, i) => (
          <div key={p.id} className="flex items-baseline justify-between gap-2">
            <span>
              {formatDate(p.promisedDate)}
              <span className="ml-1.5 text-xs text-ink-muted">
                {p.source === 'supplier' ? 'supplier' : 'our estimate'}
                {p.source === 'supplier' && promises.findIndex((x) => x.source === 'supplier') === i && ' · original'}
              </span>
              {p.note && <span className="block text-xs text-ink-muted">{p.note}</span>}
            </span>
            <span className="shrink-0 text-xs text-ink-muted">{formatDateTime(p.recordedAt)}</span>
          </div>
        ))}
      </div>

      {canEdit && open && (
        <div className="space-y-2 rounded-input bg-surface-2 p-3">
          <p className="text-xs text-ink-muted">Record the date the supplier gave, or a new one if it changed.</p>
          <div className="flex flex-wrap items-end gap-2">
            <Input label="Supplier's date" type="date" value={promisedDate} onChange={(e: any) => setPromisedDate(e.target.value)} className="w-40" />
            <Input label="Note" value={note} maxLength={300} onChange={(e: any) => setNote(e.target.value)} placeholder="e.g. by phone" className="min-w-0 flex-1" />
            <Button size="sm" onClick={savePromise} loading={busy} disabled={!promisedDate}>Save date</Button>
          </div>
        </div>
      )}

      <div className="space-y-1.5 text-sm">
        <p className="text-xs font-medium uppercase tracking-wide text-ink-muted">Deliveries</p>
        {receipts.length === 0 ? (
          <p className="text-xs text-ink-muted">Nothing delivered yet.</p>
        ) : receipts.map((r) => (
          <div key={r.id}>
            <div className="flex items-baseline justify-between gap-2">
              <span>
                Arrived {formatDateTime(r.deliveredAt)}
                {r.deliveryNote && <span className="ml-1.5 text-xs text-ink-muted">· note {r.deliveryNote}</span>}
              </span>
              <span className="shrink-0 text-xs text-ink-muted">
                {r.lines.reduce((s, l) => s + Number(l.quantity), 0)} units
              </span>
            </div>
            {r.lines.some((l) => l.expiryDate) && (
              <p className="text-xs text-ink-muted">
                Expires {Array.from(new Set(r.lines.map((l) => l.expiryDate).filter(Boolean) as string[])).map((d) => formatDate(d)).join(', ')}
              </p>
            )}
            <p className="text-xs text-ink-muted">
              {r.deliveredAtSource === 'backfilled'
                ? 'From older records: arrival time is when it was entered'
                : `Entered ${formatDateTime(r.recordedAt)}${r.recordedBy ? ` by ${r.recordedBy}` : ''}`}
            </p>
          </div>
        ))}
        {po.shortClosedAt && (
          <p className="rounded-input bg-surface-2 px-2 py-1.5 text-xs text-ink-muted">
            Remainder closed {formatDateTime(po.shortClosedAt)}: {po.shortCloseReason}
          </p>
        )}
      </div>

      {canEdit && po.status === 'partially_received' && remaining > 0 && (
        closing ? (
          <div className="space-y-2 rounded-input border border-warning bg-warning-light p-3">
            <p className="text-xs text-ink">
              The {remaining} units still outstanding will be marked as never delivered. The order is then complete and owed only for what arrived.
            </p>
            <Input label="Why won't the rest come?" value={reason} maxLength={500} onChange={(e: any) => setReason(e.target.value)} />
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="secondary" onClick={() => setClosing(false)} disabled={busy}>Keep waiting</Button>
              <Button size="sm" variant="danger" onClick={closeRemainder} loading={busy} disabled={reason.trim().length < 3}>
                Close remainder
              </Button>
            </div>
          </div>
        ) : (
          <Button size="sm" variant="secondary" onClick={() => setClosing(true)}>Close the undelivered remainder</Button>
        )
      )}
    </div>
  );
}
