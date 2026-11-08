'use client';

import { useCallback, useEffect, useState, useRef } from 'react';
import { SlidersHorizontal, RotateCcw } from 'lucide-react';
import Button from '@/components/ui/Button';

export interface ColumnOption {
  id: string;
  label: string;
  description?: string;
  defaultVisible: boolean;
  required?: boolean;
}

export const PRODUCT_COLUMNS: ColumnOption[] = [
  { id: 'image', label: 'Image', defaultVisible: true },
  { id: 'product', label: 'Product Name', defaultVisible: true, required: true },
  { id: 'category', label: 'Category', defaultVisible: true },
  { id: 'brand', label: 'Brand', defaultVisible: true },
  { id: 'sku', label: 'SKU / Variants', defaultVisible: true },
  { id: 'price', label: 'Selling Price', defaultVisible: true },
  { id: 'cost', label: 'Cost Price', defaultVisible: false },
  { id: 'restrictions', label: 'Pricing Restrictions', defaultVisible: true },
  { id: 'stock', label: 'Stock Level', defaultVisible: true },
  { id: 'status', label: 'Status', defaultVisible: true },
  { id: 'actions', label: 'Actions', defaultVisible: true, required: true },
];

const STORAGE_KEY = 'edara_products_columns_config';

export function useProductColumns(canViewCost = false) {
  const [visibleColumns, setVisibleColumns] = useState<Set<string>>(() => {
    if (typeof window === 'undefined') {
      return new Set(PRODUCT_COLUMNS.filter((c) => c.defaultVisible).map((c) => c.id));
    }
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) return new Set(parsed);
      }
    } catch {
      // ignore
    }
    return new Set(PRODUCT_COLUMNS.filter((c) => c.defaultVisible).map((c) => c.id));
  });

  const saveColumns = (cols: Set<string>) => {
    setVisibleColumns(cols);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify([...cols]));
    } catch {
      // ignore
    }
  };

  const toggleColumn = (id: string) => {
    const next = new Set(visibleColumns);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    saveColumns(next);
  };

  const resetToDefault = () => {
    const def = new Set(
      PRODUCT_COLUMNS.filter((c) => c.defaultVisible && (c.id !== 'cost' || canViewCost)).map(
        (c) => c.id,
      ),
    );
    saveColumns(def);
  };

  const isColumnVisible = useCallback(
    (id: string) => {
      if (id === 'cost' && !canViewCost) return false;
      return visibleColumns.has(id);
    },
    [visibleColumns, canViewCost],
  );

  return { visibleColumns, toggleColumn, resetToDefault, isColumnVisible };
}

export default function ProductColumnsConfig({
  visibleColumns,
  toggleColumn,
  resetToDefault,
  canViewCost = false,
}: {
  visibleColumns: Set<string>;
  toggleColumn: (id: string) => void;
  resetToDefault: () => void;
  canViewCost?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [open]);

  const availableColumns = PRODUCT_COLUMNS.filter((c) => c.id !== 'cost' || canViewCost);

  return (
    <div className="relative inline-block text-left" ref={ref}>
      <Button
        variant="secondary"
        size="sm"
        leftIcon={<SlidersHorizontal size={14} />}
        onClick={() => setOpen((o) => !o)}
      >
        Columns
      </Button>

      {open && (
        <div className="absolute right-0 z-50 mt-2 w-64 rounded-lg border border-border bg-surface p-3 shadow-lg">
          <div className="mb-2 flex items-center justify-between border-b border-border pb-2">
            <span className="text-xs font-semibold text-ink">Customize Columns</span>
            <button
              type="button"
              onClick={resetToDefault}
              className="flex items-center gap-1 text-[11px] text-ink-muted hover:text-ink"
              title="Reset to default columns"
            >
              <RotateCcw size={11} /> Reset
            </button>
          </div>

          <div className="max-h-60 space-y-1.5 overflow-y-auto pr-1">
            {availableColumns.map((col) => {
              const checked = visibleColumns.has(col.id);
              return (
                <label
                  key={col.id}
                  className={`flex items-center justify-between rounded px-2 py-1 text-xs transition ${
                    col.required
                      ? 'cursor-not-allowed opacity-60'
                      : 'cursor-pointer hover:bg-surface-2'
                  }`}
                >
                  <span className="text-ink">{col.label}</span>
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={col.required}
                    onChange={() => !col.required && toggleColumn(col.id)}
                    className="rounded border-border text-accent focus:ring-accent"
                  />
                </label>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

