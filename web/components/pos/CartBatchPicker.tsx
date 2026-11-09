'use client';

import { useEffect, useMemo, useState } from 'react';
import { Layers } from 'lucide-react';
import { getStockBatches, type StockBatch } from '@/services/stockService';
import { usePosStore } from '@/store/posStore';
import { formatCurrency, formatQty } from '@/lib/utils/format';
import { cn } from '@/lib/utils/cn';

// A short-lived per-variant cache, so a cart re-render doesn't refetch.
const cache = new Map<string, { at: number; batches: Promise<StockBatch[]> }>();
function batchesFor(variantId: string): Promise<StockBatch[]> {
  const hit = cache.get(variantId);
  if (hit && Date.now() - hit.at < 30_000) return hit.batches;
  const batches = getStockBatches([variantId]).then((r: any) => r || []).catch(() => {
    cache.delete(variantId);
    return [];
  });
  cache.set(variantId, { at: Date.now(), batches });
  return batches;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

function batchLabel(b: StockBatch) {
  const date = new Date(b.firstReceivedAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  const supplier = b.suppliers[0] ? ` · ${b.suppliers[0]}` : '';
  return `${b.batchNumber} · received ${date}${supplier}`;
}

type Selection = { batchId: string; quantity: number }[];

// Lets the cashier say which cost batches a cart line comes from, split
// across several if needed. Shown only when the product has more than one
// batch in stock. Left alone, the oldest batches are used.
export default function CartBatchPicker({
  line,
}: {
  line: { variantId: string | number; quantity: number; batchSelection?: Selection | null };
}) {
  const [batches, setBatches] = useState<StockBatch[]>([]);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const setSelection = usePosStore((s) => s.setBatchSelection);
  const variantId = String(line.variantId);

  useEffect(() => {
    let live = true;
    batchesFor(variantId).then((b) => { if (live) setBatches(b.filter((x) => x.qtyOnHand > 0)); });
    return () => { live = false; };
  }, [variantId]);

  const chosen = useMemo(
    () => new Map((line.batchSelection || []).map((s) => [s.batchId, s.quantity])),
    [line.batchSelection],
  );
  useEffect(() => {
    if (open) setDraft(Object.fromEntries([...chosen].map(([id, q]) => [id, String(q)])));
  }, [open, chosen]);

  if (batches.length < 2) return null;

  const quantity = round2(Number(line.quantity) || 0);
  const draftTotal = round2(Object.values(draft).reduce((s, v) => s + (Number(v) || 0), 0));
  const overBatch = batches.some((b) => (Number(draft[b.id]) || 0) > b.qtyOnHand);
  const valid = draftTotal === quantity && !overBatch;

  const summary = line.batchSelection?.length
    ? line.batchSelection
      .map((s) => `${batches.find((b) => b.id === s.batchId)?.batchNumber || 'batch'} × ${formatQty(s.quantity)}`)
      .join(', ')
    : 'Oldest first';

  return (
    <div className="mt-2 text-xs" onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex max-w-full items-center gap-1 rounded-input border border-border px-2 py-1 text-ink-muted hover:text-ink"
        aria-expanded={open}
      >
        <Layers className="h-3 w-3 shrink-0" aria-hidden />
        <span className="truncate">Batch: <span className="font-medium text-ink">{summary}</span></span>
      </button>
      {open && (
        <div className="mt-2 space-y-1.5 rounded-input border border-border bg-surface p-2">
          {batches.map((b) => (
            <label key={b.id} className="flex items-center justify-between gap-2">
              <span className="min-w-0">
                <span className="block truncate text-ink">{batchLabel(b)}</span>
                <span className="text-ink-muted">
                  {formatQty(b.qtyOnHand)} in stock
                  {b.unitCost != null && <> · cost {formatCurrency(b.unitCost)}</>}
                </span>
              </span>
              <input
                type="number"
                min={0}
                max={b.qtyOnHand}
                step="any"
                inputMode="decimal"
                value={draft[b.id] ?? ''}
                placeholder="0"
                aria-label={`Quantity from ${b.batchNumber}`}
                onChange={(e) => setDraft((d) => ({ ...d, [b.id]: e.target.value }))}
                className={cn(
                  'h-9 w-20 rounded-input border px-2 text-right text-sm focus:outline-none focus:ring-2 focus:ring-accent/30',
                  (Number(draft[b.id]) || 0) > b.qtyOnHand ? 'border-error' : 'border-border',
                )}
              />
            </label>
          ))}
          <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
            <span className={valid ? 'text-ink-muted' : 'text-error'}>
              {formatQty(draftTotal)} of {formatQty(quantity)} chosen
            </span>
            <span className="flex gap-1">
              <button
                type="button"
                className="rounded-input px-2 py-1 text-ink-muted hover:text-ink"
                onClick={() => { setSelection(line.variantId, null); setOpen(false); }}
              >
                Oldest first
              </button>
              <button
                type="button"
                disabled={!valid}
                className="rounded-input bg-accent px-2 py-1 font-medium text-white disabled:opacity-50"
                onClick={() => {
                  setSelection(line.variantId, Object.entries(draft)
                    .map(([batchId, v]) => ({ batchId, quantity: round2(Number(v) || 0) }))
                    .filter((s) => s.quantity > 0));
                  setOpen(false);
                }}
              >
                Use these
              </button>
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
