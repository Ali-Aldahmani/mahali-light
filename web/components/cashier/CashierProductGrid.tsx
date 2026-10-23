'use client';

import { memo } from 'react';
import { Package, ScanLine } from 'lucide-react';
import { fileUrl } from '@/lib/config';
import { formatCurrency } from '@/lib/utils/format';
import { cn } from '@/lib/utils/cn';
import Skeleton from '@/components/ui/skeleton';

export interface CashierCategory {
  id: string | number;
  name: string;
  parentId?: string | number | null;
}

// Category chips + product tiles. One tap on a tile adds it to the sale;
// out-of-stock tiles stay visible but disabled (unless negative stock is on).
export default function CashierProductGrid({
  categories,
  activeCategoryId,
  onCategoryChange,
  products,
  loading,
  query,
  allowNegativeStock,
  onAdd,
}: {
  categories: CashierCategory[];
  activeCategoryId: string | number | null;
  onCategoryChange: (id: string | number | null) => void;
  products: any[];
  loading: boolean;
  query: string;
  allowNegativeStock: boolean;
  onAdd: (variant: any) => void;
}) {
  const roots = categories.filter((c) => !c.parentId);
  return (
    <section aria-label="Products" className="flex min-h-0 min-w-0 flex-1 flex-col bg-bg">
      <div
        role="tablist"
        aria-label="Categories"
        className="flex shrink-0 gap-2 overflow-x-auto border-b border-border bg-surface px-3 py-2"
      >
        <CategoryChip label="All" active={!activeCategoryId} onClick={() => onCategoryChange(null)} />
        {roots.map((c) => (
          <CategoryChip
            key={c.id}
            label={c.name}
            active={activeCategoryId === c.id}
            onClick={() => onCategoryChange(c.id)}
          />
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {loading && products.length === 0 ? (
          <div className="rounded-card border border-border bg-surface p-5">
            <Skeleton lines={6} label="Loading products" />
          </div>
        ) : products.length === 0 ? (
          <div className="mx-auto mt-10 max-w-sm rounded-card border border-dashed border-border bg-surface p-8 text-center">
            {query ? (
              <Package className="mx-auto h-8 w-8 text-ink-muted" />
            ) : (
              <ScanLine className="mx-auto h-8 w-8 text-ink-muted" />
            )}
            <p className="mt-2 text-sm text-ink-muted">
              {query ? `No products match “${query}”.` : 'Scan a barcode or search to start a sale.'}
            </p>
          </div>
        ) : (
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
            {products.map((v) => (
              <li key={v.variantId}>
                <ProductTile variant={v} allowNegativeStock={allowNegativeStock} onAdd={onAdd} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function CategoryChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        'h-11 shrink-0 rounded-full px-4 text-sm font-medium transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1',
        active ? 'bg-accent text-white' : 'bg-surface-2 text-ink hover:bg-accent-light',
      )}
    >
      {label}
    </button>
  );
}

const ProductTile = memo(function ProductTile({
  variant,
  allowNegativeStock,
  onAdd,
}: {
  variant: any;
  allowNegativeStock: boolean;
  onAdd: (variant: any) => void;
}) {
  const stock = Number(variant.stockQty || 0);
  const out = stock <= 0 && !allowNegativeStock;
  const attrs = (variant.attributes || [])
    .slice(0, 3)
    .map((a: any) => `${a.value}${a.unit || ''}`)
    .join(' · ');
  const price = formatCurrency(variant.sellingPrice || 0);
  return (
    <button
      type="button"
      disabled={out}
      onClick={() => onAdd(variant)}
      aria-label={`Add ${variant.productName}${attrs ? ` ${attrs}` : ''}, ${price}, ${
        stock > 0 ? `${stock} in stock` : 'out of stock'
      }`}
      className={cn(
        'flex h-full min-h-[9.5rem] w-full flex-col rounded-card border border-border bg-surface p-2.5 text-left shadow-card',
        'touch-manipulation select-none transition-colors active:bg-accent-light',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
        out ? 'cursor-not-allowed opacity-50' : 'hover:border-accent',
      )}
    >
      <div className="mb-2 flex h-20 w-full items-center justify-center overflow-hidden rounded-md bg-surface-2">
        {variant.imagePath ? (
          <img
            src={fileUrl(variant.imagePath)}
            alt=""
            loading="lazy"
            className="h-full w-full object-cover"
          />
        ) : (
          <Package className="h-7 w-7 text-ink-muted" aria-hidden />
        )}
      </div>
      <span className="line-clamp-2 text-sm font-medium leading-tight text-ink">{variant.productName}</span>
      {attrs && <span className="mt-0.5 truncate text-[11px] text-ink-muted">{attrs}</span>}
      <span className="mt-auto flex items-end justify-between gap-1 pt-1.5">
        <span className="text-base font-semibold text-accent">{price}</span>
        <span
          className={cn(
            'text-[11px] font-medium',
            stock <= 0 ? 'text-error' : stock <= 5 ? 'text-warning' : 'text-ink-muted',
          )}
        >
          {stock <= 0 ? 'Out' : `${stock} ${variant.unitLabel || 'pcs'}`}
        </span>
      </span>
    </button>
  );
});
