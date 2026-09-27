'use client';

import { cn } from '@/lib/utils/cn';
import { formatQty } from '@/lib/utils/format';
import { formatAed } from '@/lib/mobile/format';

const RANK_TONES: Record<number, string> = {
  1: 'bg-[#FEF3C7] text-[#B45309]',
  2: 'bg-[#E4E4E7] text-[#3F3F46]',
  3: 'bg-[#FFEDD5] text-[#C2410C]',
};

export interface TopProductRow {
  product_id: string | number;
  variant_id?: string | number | null;
  rank: number;
  product_name: string;
  sku?: string | null;
  units_sold: number | string;
  revenue: number | string;
}

const GRID = 'grid grid-cols-[36px_minmax(0,1fr)_52px_92px] items-center gap-x-2';

export default function MobileTopProductsTable({ rows }: { rows: TopProductRow[] }) {
  return (
    <div role="table" aria-label="Top products" className="font-m-inter">
      <div role="row" className={cn(GRID, 'px-2 pb-2 text-[14px] font-bold text-ink-muted')}>
        <span role="columnheader">#</span>
        <span role="columnheader">Product</span>
        <span role="columnheader" className="text-center">Units</span>
        <span role="columnheader" className="text-center">Revenue</span>
      </div>
      <div role="rowgroup" className="space-y-2">
        {rows.map((r) => (
          <div
            role="row"
            key={`${r.product_id}-${r.variant_id ?? ''}`}
            className={cn(GRID, 'min-h-[72px] rounded-[10px] bg-m-row px-2 py-3')}
          >
            <span role="cell">
              <span
                className={cn(
                  'inline-flex h-7 w-7 items-center justify-center rounded-full text-[12px] font-semibold',
                  RANK_TONES[r.rank] || 'bg-surface-2 text-ink-muted',
                )}
              >
                {r.rank}
              </span>
            </span>
            <span role="cell" className="min-w-0">
              <span className="line-clamp-2 break-words text-[14px] font-medium text-ink">{r.product_name}</span>
              {r.sku && <span className="block truncate text-[12px] text-ink-muted">SKU {r.sku}</span>}
            </span>
            <span role="cell" className="text-center text-[14px] text-ink">
              {formatQty(r.units_sold)}
            </span>
            <span role="cell" className="flex justify-center">
              <span className="inline-flex min-h-[36px] items-center justify-center rounded-full bg-accent-light px-3 text-center text-[12px] font-semibold leading-tight text-accent">
                {formatAed(r.revenue)}
              </span>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
