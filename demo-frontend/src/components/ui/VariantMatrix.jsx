import { useMemo, useState } from 'react';
import { Pencil, Trash2 } from 'lucide-react';
import Button from './Button.jsx';
import StockBadge from './StockBadge.jsx';
import BarcodeDisplay from './BarcodeDisplay.jsx';
import { cn } from '../../utils/cn.js';
import { fileUrl } from '../../config.js';

// Read-only table of saved variants on the product detail page.
// rows: variant objects from the API
// attributes: ordered category attributes (for column headers)
// onEdit / onDelete: row actions
export default function VariantMatrix({
  variants = [],
  attributes = [],
  showCost = false,
  unitLabel = 'pcs',
  onEdit,
  onDelete,
  className = '',
}) {
  const [sortKey, setSortKey] = useState('sku');
  const [sortDir, setSortDir] = useState('asc');

  const sorted = useMemo(() => {
    const accessor = {
      sku: (v) => v.sku,
      price: (v) => Number(v.sellingPrice || 0),
      cost: (v) => Number(v.costPrice || 0),
      stock: (v) => Number(v.stockQty || 0),
    };
    const get = accessor[sortKey] || ((v) => v.sku);
    const arr = [...variants].sort((a, b) => {
      const av = get(a);
      const bv = get(b);
      if (typeof av === 'number' && typeof bv === 'number') return av - bv;
      return String(av).localeCompare(String(bv));
    });
    if (sortDir === 'desc') arr.reverse();
    return arr;
  }, [variants, sortKey, sortDir]);

  function toggleSort(key) {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  }

  return (
    <div className={cn('card overflow-hidden', className)}>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-surface-2 text-ink-muted">
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide w-16">
                Image
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide">
                <SortBtn label="SKU" active={sortKey === 'sku'} dir={sortDir} onClick={() => toggleSort('sku')} />
              </th>
              {attributes.map((a) => (
                <th
                  key={a.attributeId}
                  className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide whitespace-nowrap"
                >
                  {a.name}
                  {a.unit && <span className="text-ink-muted/70 normal-case font-normal ml-1">({a.unit})</span>}
                </th>
              ))}
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide">
                Barcode
              </th>
              <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide">
                <SortBtn label="Price" active={sortKey === 'price'} dir={sortDir} onClick={() => toggleSort('price')} />
              </th>
              {showCost && (
                <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide">
                  <SortBtn label="Cost" active={sortKey === 'cost'} dir={sortDir} onClick={() => toggleSort('cost')} />
                </th>
              )}
              <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide">
                <SortBtn label="Stock" active={sortKey === 'stock'} dir={sortDir} onClick={() => toggleSort('stock')} />
              </th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 && (
              <tr>
                <td
                  colSpan={6 + attributes.length + (showCost ? 1 : 0)}
                  className="px-4 py-12 text-center text-ink-muted"
                >
                  No variants yet.
                </td>
              </tr>
            )}
            {sorted.map((v) => {
              const lowStock =
                Number(v.stockQty || 0) <= Number(v.reorderThreshold || 0) &&
                Number(v.reorderThreshold || 0) > 0;
              return (
                <tr
                  key={v.id}
                  className={cn(
                    'border-t border-border',
                    lowStock && 'bg-warning-light/40',
                  )}
                >
                  <td className="px-4 py-2.5">
                    {v.imagePath ? (
                      <img
                        src={fileUrl(v.imagePath)}
                        alt={v.sku}
                        className="h-10 w-10 rounded-md object-cover border border-border"
                      />
                    ) : (
                      <div className="h-10 w-10 rounded-md bg-surface-2 border border-border" />
                    )}
                  </td>
                  <td className="px-4 py-2.5 font-mono text-xs text-ink">{v.sku}</td>
                  {attributes.map((a) => {
                    const link = (v.attributes || []).find(
                      (x) => x.attributeId === a.attributeId,
                    );
                    return (
                      <td key={a.attributeId} className="px-4 py-2.5 text-ink-muted">
                        {link ? link.value : '—'}
                      </td>
                    );
                  })}
                  <td className="px-4 py-2.5">
                    <BarcodeDisplay value={v.internalBarcode || v.barcode} size="sm" />
                  </td>
                  <td className="px-4 py-2.5 text-right font-medium text-ink">
                    {Number(v.sellingPrice || 0).toFixed(2)}
                  </td>
                  {showCost && (
                    <td className="px-4 py-2.5 text-right text-ink-muted">
                      {Number(v.costPrice || 0).toFixed(2)}
                    </td>
                  )}
                  <td className="px-4 py-2.5 text-right">
                    <StockBadge
                      qty={v.stockQty}
                      threshold={v.reorderThreshold}
                      unitLabel={unitLabel}
                    />
                  </td>
                  <td className="px-4 py-2.5 text-right whitespace-nowrap">
                    {onEdit && (
                      <Button
                        variant="ghost"
                        size="sm"
                        leftIcon={<Pencil size={13} />}
                        onClick={() => onEdit(v)}
                      >
                        Edit
                      </Button>
                    )}
                    {onDelete && (
                      <Button
                        variant="ghost"
                        size="sm"
                        leftIcon={<Trash2 size={13} />}
                        className="text-error hover:bg-error-light"
                        onClick={() => onDelete(v)}
                      >
                        Delete
                      </Button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SortBtn({ label, active, dir, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1 hover:text-ink',
        active && 'text-ink',
      )}
    >
      {label}
      {active && <span className="text-[10px]">{dir === 'asc' ? '▲' : '▼'}</span>}
    </button>
  );
}
