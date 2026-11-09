'use client';

import { useEffect, useState } from 'react';
import { getStockBatches, type StockBatch } from '@/services/stockService';
import { formatCurrency, formatQty } from '@/lib/utils/format';

const SOURCE_LABELS: Record<string, string> = {
  purchase_order: 'Purchase order',
  opening_balance: 'Stock before batches',
  opening_stock: 'Opening stock',
  adjustment_direct: 'Adjustment',
  adjustment_request: 'Adjustment',
  count_correction: 'Stock count',
  return_order: 'Customer return',
  invoice_cancel: 'Cancelled sale',
  invoice_edit: 'Sale edit',
  supplier_return: 'Supplier return',
  quarantine: 'Quarantine',
};

function day(d: string) {
  return new Date(d).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

// The cost groups of one variant: stock held at each unit cost, with every
// receipt that went into it. Cost columns only reach users who may see cost.
export default function CostBatchesTable({ variantId, unitLabel = '' }: { variantId: string; unitLabel?: string }) {
  const [batches, setBatches] = useState<StockBatch[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setBatches(null);
    getStockBatches([variantId])
      .then((b: any) => { if (live) setBatches(b || []); })
      .catch((e: any) => { if (live) setError(e?.message || 'Could not load batches.'); });
    return () => { live = false; };
  }, [variantId]);

  if (error) return <p className="px-4 py-3 text-xs text-error">{error}</p>;
  if (!batches) return <p className="px-4 py-3 text-xs text-ink-muted">Loading batches…</p>;
  if (!batches.length) return <p className="px-4 py-3 text-xs text-ink-muted">No stock in any batch.</p>;
  const withCost = batches.some((b) => b.unitCost != null);

  return (
    <div className="overflow-x-auto px-4 py-3">
      <table className="w-full text-xs">
        <thead className="text-ink-muted">
          <tr>
            <th className="py-1 pr-3 text-left font-semibold">Batch</th>
            {withCost && <th className="py-1 pr-3 text-right font-semibold">Unit cost</th>}
            <th className="py-1 pr-3 text-right font-semibold">On hand</th>
            <th className="py-1 pr-3 text-right font-semibold">Quarantine</th>
            {withCost && <th className="py-1 pr-3 text-right font-semibold">Value</th>}
            <th className="py-1 text-left font-semibold">Receipts</th>
          </tr>
        </thead>
        <tbody>
          {batches.map((b) => (
            <tr key={b.id} className="border-t border-border align-top">
              <td className="py-1.5 pr-3">
                <div className="font-mono text-ink">{b.batchNumber}</div>
                <div className="text-ink-muted">since {day(b.firstReceivedAt)}</div>
              </td>
              {withCost && <td className="py-1.5 pr-3 text-right font-medium">{formatCurrency(b.unitCost)}</td>}
              <td className="py-1.5 pr-3 text-right">{formatQty(b.qtyOnHand)} {unitLabel}</td>
              <td className="py-1.5 pr-3 text-right text-ink-muted">{b.qtyQuarantined ? formatQty(b.qtyQuarantined) : '—'}</td>
              {withCost && <td className="py-1.5 pr-3 text-right">{formatCurrency(b.value)}</td>}
              <td className="py-1.5">
                <ul className="space-y-0.5">
                  {b.receipts.map((r) => (
                    <li key={r.id} className="text-ink-muted">
                      {day(r.receivedAt)} · {formatQty(r.quantity)} from{' '}
                      {r.documentNumber || SOURCE_LABELS[r.sourceType] || r.sourceType}
                      {r.supplierName && <> · {r.supplierName}</>}
                    </li>
                  ))}
                </ul>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {withCost && (
        <p className="mt-2 text-[11px] text-ink-muted">
          Batch costs are what each group was bought at. Stock value and cost of sales in the books use the latest purchase cost.
        </p>
      )}
    </div>
  );
}
