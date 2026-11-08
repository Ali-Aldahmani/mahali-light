'use client';

import { useMemo } from 'react';
import { Pencil, Trash2, Tag, Barcode } from 'lucide-react';
import StockBadge from '@/components/ui/StockBadge';
import Badge, { StatusBadge } from '@/components/ui/Badge';
import RowActions from '@/components/ui/RowActions';
import { highlightText } from '@/lib/utils/highlight';
import { fileUrl } from '@/lib/config';

export interface VariantSubTableProps {
  product: any;
  variants: any[];
  searchQuery?: string;
  selectedVariantIds: Set<string>;
  onToggleVariant: (id: string) => void;
  canViewCost?: boolean;
  canEditProduct?: boolean;
  canDeleteProduct?: boolean;
  onEditVariant: (variant: any) => void;
  onDeleteVariant: (variant: any) => void;
}

// Whether a variant is what a search found. Also decides which products the
// list opens automatically, so the two always agree.
export function variantMatchesSearch(v: any, searchQuery: string): boolean {
  const q = searchQuery.trim().toLowerCase();
  if (!q) return false;
  return Boolean(
    (v.sku && v.sku.toLowerCase().includes(q)) ||
      (v.barcode && v.barcode.toLowerCase().includes(q)) ||
      (v.internalBarcode && v.internalBarcode.toLowerCase().includes(q)) ||
      (v.supplierBarcode && v.supplierBarcode.toLowerCase().includes(q)) ||
      (Array.isArray(v.attributes) &&
        v.attributes.some((a: any) => a.value && String(a.value).toLowerCase().includes(q))),
  );
}

export default function VariantSubTable({
  product,
  variants = [],
  searchQuery = '',
  selectedVariantIds,
  onToggleVariant,
  canViewCost = false,
  canEditProduct = false,
  canDeleteProduct = false,
  onEditVariant,
  onDeleteVariant,
}: VariantSubTableProps) {
  if (!variants || variants.length === 0) {
    return (
      <div className="py-4 px-8 text-xs text-ink-muted italic">
        No active variants found for this product.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto bg-surface-2/60 px-4 py-3 sm:px-8 border-y border-border/50">
      <div className="mb-2 flex items-center justify-between text-xs text-ink-muted">
        <span className="font-semibold uppercase tracking-wider text-[11px] text-ink">
          Variants ({variants.length})
        </span>
        <span className="text-[11px]">
          Sold by: <strong className="text-ink">{product.soldBy || 'piece'}</strong> · Unit:{' '}
          <strong className="text-ink">{product.unitLabel || 'pcs'}</strong>
        </span>
      </div>

      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-border/60 text-ink-muted text-left font-medium">
            <th className="py-2 px-2 w-8">
              <span className="sr-only">Select</span>
            </th>
            <th className="py-2 px-2">Variant / Attributes</th>
            <th className="py-2 px-2">SKU</th>
            <th className="py-2 px-2">Barcodes</th>
            <th className="py-2 px-2 text-right">Selling Price</th>
            {canViewCost && <th className="py-2 px-2 text-right">Cost Price</th>}
            <th className="py-2 px-2 text-right">Stock</th>
            <th className="py-2 px-2 text-center">Status</th>
            <th className="py-2 px-2 text-right w-12"></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border/40">
          {variants.map((v) => {
            const matched = variantMatchesSearch(v, searchQuery);
            const isSelected = selectedVariantIds.has(v.id);

            return (
              <tr
                key={v.id}
                className={`transition ${
                  matched
                    ? 'bg-accent/15 border-l-4 border-l-accent'
                    : isSelected
                      ? 'bg-accent/5'
                      : 'hover:bg-surface/80'
                }`}
              >
                {/* Selection Checkbox */}
                <td className="py-2.5 px-2 align-middle">
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => onToggleVariant(v.id)}
                    onClick={(e) => e.stopPropagation()}
                    aria-label={`Select variant ${v.sku || v.id}`}
                  />
                </td>

                {/* Variant Attributes & Thumbnail */}
                <td className="py-2.5 px-2 align-middle">
                  <div className="flex items-center gap-2">
                    {v.imagePath ? (
                      <img
                        src={fileUrl(v.imagePath)}
                        alt={v.sku || 'Variant'}
                        className="h-8 w-8 rounded border border-border object-cover"
                      />
                    ) : (
                      <div className="h-8 w-8 rounded bg-surface border border-border flex items-center justify-center text-ink-muted">
                        <Tag size={12} />
                      </div>
                    )}
                    <div>
                      {v.attributes && v.attributes.length > 0 ? (
                        <div className="flex flex-wrap gap-1">
                          {v.attributes.map((a: any, i: number) => (
                            <span
                              key={i}
                              className="inline-flex items-center rounded bg-surface px-1.5 py-0.5 text-[11px] font-medium text-ink border border-border/60"
                            >
                              {a.attributeName ? `${a.attributeName}: ` : ''}
                              {highlightText(a.value, searchQuery)}
                              {a.unit ? ` ${a.unit}` : ''}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span className="text-ink font-medium">Standard</span>
                      )}
                      {matched && (
                        <span className="ml-1.5 inline-block text-[10px] font-semibold text-accent uppercase tracking-wide">
                          Search Match
                        </span>
                      )}
                    </div>
                  </div>
                </td>

                {/* SKU */}
                <td className="py-2.5 px-2 align-middle font-mono text-[11px]">
                  {highlightText(v.sku, searchQuery)}
                </td>

                {/* Barcodes */}
                <td className="py-2.5 px-2 align-middle font-mono text-[11px] text-ink-muted">
                  <div className="space-y-0.5">
                    {v.barcode && (
                      <div className="flex items-center gap-1" title="Primary Barcode">
                        <Barcode size={11} className="opacity-70" />
                        <span>{highlightText(v.barcode, searchQuery)}</span>
                      </div>
                    )}
                    {v.internalBarcode && v.internalBarcode !== v.barcode && (
                      <div className="text-[10px] opacity-80" title="Internal Barcode">
                        int: {highlightText(v.internalBarcode, searchQuery)}
                      </div>
                    )}
                    {v.supplierBarcode && (
                      <div className="text-[10px] opacity-80" title="Supplier Barcode">
                        sup: {highlightText(v.supplierBarcode, searchQuery)}
                      </div>
                    )}
                    {!v.barcode && !v.internalBarcode && !v.supplierBarcode && <span>—</span>}
                  </div>
                </td>

                {/* Selling Price */}
                <td className="py-2.5 px-2 align-middle text-right font-medium text-ink">
                  {Number(v.sellingPrice || 0).toFixed(2)}{' '}
                  <span className="text-[10px] text-ink-muted font-normal">AED</span>
                </td>

                {/* Cost Price (guarded by permission) */}
                {canViewCost && (
                  <td className="py-2.5 px-2 align-middle text-right text-ink-muted">
                    {v.costPrice !== undefined ? (
                      <>
                        {Number(v.costPrice).toFixed(2)}{' '}
                        <span className="text-[10px] font-normal">AED</span>
                      </>
                    ) : (
                      '—'
                    )}
                  </td>
                )}

                {/* Stock Indicator */}
                <td className="py-2.5 px-2 align-middle text-right">
                  <div className="inline-flex flex-col items-end gap-0.5">
                    <StockBadge
                      qty={v.stockQty}
                      threshold={v.reorderThreshold}
                      unitLabel={product.unitLabel}
                    />
                    {Number(v.quarantineQty || 0) > 0 && (
                      <span
                        className="text-[10px] text-warning"
                        title="Quarantined units cannot be sold until released"
                      >
                        ({v.quarantineQty} quarantined)
                      </span>
                    )}
                  </div>
                </td>

                {/* Status Badge */}
                <td className="py-2.5 px-2 align-middle text-center">
                  <StatusBadge active={v.isActive} />
                </td>

                {/* Row Actions */}
                <td className="py-2.5 px-2 align-middle text-right">
                  <RowActions
                    label={`Actions for variant ${v.sku || v.id}`}
                    actions={[
                      {
                        id: 'edit',
                        label: 'Edit variant',
                        icon: <Pencil size={13} />,
                        hidden: !canEditProduct,
                        onClick: () => onEditVariant(v),
                      },
                      {
                        id: 'deactivate',
                        label: 'Deactivate',
                        icon: <Trash2 size={13} />,
                        tone: 'danger',
                        hidden: !canDeleteProduct || !v.isActive,
                        onClick: () => onDeleteVariant(v),
                      },
                    ]}
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

