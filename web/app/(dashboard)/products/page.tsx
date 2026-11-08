'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ChevronDown,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  Eye,
  Package,
  Pencil,
  Plus,
  Search,
  ShieldAlert,
  Trash2,
} from 'lucide-react';
import PageHeader from '@/components/ui/PageHeader';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import Select from '@/components/ui/Select';
import Table, { type TableColumn } from '@/components/ui/Table';
import Badge, { StatusBadge } from '@/components/ui/Badge';
import StockBadge from '@/components/ui/StockBadge';
import EmptyState from '@/components/ui/EmptyState';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import PermissionGate from '@/components/ui/PermissionGate';
import CategoryTreeSelect from '@/components/ui/CategoryTreeSelect';
import RequirePermission from '@/components/guards/RequirePermission';
import Modal from '@/components/ui/Modal';
import { deleteProduct, listProducts } from '@/services/productService';
import { deleteVariant } from '@/services/variantService';
import { bulkApplyMaxDiscount } from '@/services/pricingRestrictionService';
import { useProductStore } from '@/store/productStore';
import { useAuthStore } from '@/store/authStore';
import { onProductUpdate } from '@/store/socketStore';
import { toast } from '@/store/toastStore';
import { fileUrl } from '@/lib/config';
import RowActions from '@/components/ui/RowActions';
import VariantSubTable, { variantMatchesSearch } from '@/components/products/VariantSubTable';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import VariantFormSlideOver from '@/components/products/VariantFormSlideOver';
import ProductColumnsConfig, {
  useProductColumns,
} from '@/components/products/ProductColumnsConfig';
import { highlightText } from '@/lib/utils/highlight';

const SOLD_BY_OPTIONS = [
  { value: '', label: 'All units' },
  { value: 'piece', label: 'Piece' },
  { value: 'meter', label: 'Meter' },
  { value: 'roll', label: 'Roll' },
  { value: 'kg', label: 'Kilogram' },
  { value: 'box', label: 'Box' },
];

const VARIANT_FILTER = [
  { value: '', label: 'All product types' },
  { value: 'true', label: 'With variants' },
  { value: 'false', label: 'Single (no variants)' },
];

const STATUS_FILTER = [
  { value: '', label: 'Active only' },
  { value: 'false', label: 'Inactive only' },
  { value: 'all', label: 'All statuses' },
];

function TriStateCheckbox({
  checked,
  indeterminate = false,
  onChange,
  'aria-label': ariaLabel,
}: {
  checked: boolean;
  indeterminate?: boolean;
  onChange: () => void;
  'aria-label'?: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = Boolean(indeterminate);
  }, [indeterminate]);

  return (
    <input
      ref={ref}
      type="checkbox"
      checked={checked}
      onChange={onChange}
      onClick={(e) => e.stopPropagation()}
      aria-label={ariaLabel}
      className="rounded border-border text-accent focus:ring-accent"
    />
  );
}

function ProductsPageContent() {
  const router = useRouter();
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const canViewCost = hasPermission('product.view_cost');
  const canManagePricingRestrictions = hasPermission('product.manage_pricing_restrictions');
  const canEditProduct = hasPermission('product.edit');
  const canDeleteProduct = hasPermission('product.delete');
  const refreshStore = useProductStore((s) => s.refreshAll);

  const { visibleColumns, toggleColumn, resetToDefault, isColumnVisible } =
    useProductColumns(canViewCost);

  // Expandable Variants State
  const [expandedProductIds, setExpandedProductIds] = useState<Set<string>>(new Set());

  // Hierarchical Selection State (Product & Variant level)
  const [selectedProductIds, setSelectedProductIds] = useState<Set<string>>(new Set());
  const [selectedVariantIds, setSelectedVariantIds] = useState<Set<string>>(new Set());

  // Bulk Discount Modal State
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkType, setBulkType] = useState<'MAX_DISCOUNT_PERCENT' | 'MAX_DISCOUNT_AMOUNT'>('MAX_DISCOUNT_PERCENT');
  const [bulkValue, setBulkValue] = useState('');
  const [bulkSaving, setBulkSaving] = useState(false);

  // Variant SlideOver Edit State
  const [editingVariant, setEditingVariant] = useState<any>(null);
  const [editingVariantProduct, setEditingVariantProduct] = useState<any>(null);
  const [variantSlideOverOpen, setVariantSlideOverOpen] = useState(false);

  // Deactivate Variant State
  const [confirmDelVariant, setConfirmDelVariant] = useState<{ product: any; variant: any } | null>(null);
  const [delVariantLoading, setDelVariantLoading] = useState(false);

  // Bulk Deactivate Dialog State
  const [bulkDeactivateOpen, setBulkDeactivateOpen] = useState(false);
  const [bulkDeactivating, setBulkDeactivating] = useState(false);

  const categoriesTree = useProductStore((s) => s.categoriesTree);
  const fetchCategories = useProductStore((s) => s.fetchCategories);

  const [rows, setRows] = useState<any[]>([]);
  const [meta, setMeta] = useState<{ page: number; limit: number; total: number }>({
    page: 1,
    limit: 20,
    total: 0,
  });
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search, 250);
  const fetchSeq = useRef(0);
  // Every product seen so far. Selection survives changing page, so bulk
  // actions need the variants of products that are no longer on screen.
  const knownRows = useRef(new Map<string, any>());
  const [filters, setFilters] = useState<{
    categoryId: number | null;
    soldBy: string;
    hasVariants: string;
    isActive: string;
  }>({
    categoryId: null,
    soldBy: '',
    hasVariants: '',
    isActive: '',
  });
  const [loading, setLoading] = useState(true);

  const [confirmDel, setConfirmDel] = useState<any>(null);
  const [delLoading, setDelLoading] = useState(false);

  const fetch = useCallback(async () => {
    // Only the newest request may fill the table; an older, slower response
    // would otherwise replace the results of the current search.
    const seq = ++fetchSeq.current;
    setLoading(true);
    try {
      const { data, meta: m } = await listProducts({
        page,
        limit: 20,
        search: debouncedSearch,
        categoryId: filters.categoryId ?? undefined,
        soldBy: filters.soldBy || undefined,
        hasVariants: filters.hasVariants || undefined,
        isActive: filters.isActive || undefined,
      });
      if (seq !== fetchSeq.current) return;
      for (const row of data || []) knownRows.current.set(row.id, row);
      setRows(data || []);
      setMeta(m || { page: 1, limit: 20, total: 0 });
    } catch (err: any) {
      if (seq === fetchSeq.current) toast.error(err?.message || 'Failed to load products');
    } finally {
      if (seq === fetchSeq.current) setLoading(false);
    }
  }, [page, debouncedSearch, filters]);

  useEffect(() => {
    fetchCategories();
  }, [fetchCategories]);

  useEffect(() => {
    fetch();
  }, [fetch]);

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, filters]);

  // Real-time refresh from socket
  useEffect(() => {
    const off = onProductUpdate(() => {
      fetch();
    });
    return off;
  }, [fetch]);

  // Requirement #3: Searching by variant SKU/barcode must automatically reveal matching variants under parent
  useEffect(() => {
    if (!search.trim() || rows.length === 0) return;

    const matchedProductIds = new Set<string>();
    for (const r of rows) {
      if (Array.isArray(r.variants) && r.variants.some((v: any) => variantMatchesSearch(v, search))) {
        matchedProductIds.add(r.id);
      }
    }

    if (matchedProductIds.size > 0) {
      setExpandedProductIds((prev) => {
        const next = new Set(prev);
        matchedProductIds.forEach((id) => next.add(id));
        return next;
      });
    }
  }, [search, rows]);

  // Expansion Helpers
  const toggleExpand = (productId: string) => {
    setExpandedProductIds((prev) => {
      const next = new Set(prev);
      if (next.has(productId)) next.delete(productId);
      else next.add(productId);
      return next;
    });
  };

  const expandAll = () => {
    setExpandedProductIds(new Set(rows.map((r) => r.id)));
  };

  const collapseAll = () => {
    setExpandedProductIds(new Set());
  };

  const allExpanded = rows.length > 0 && rows.every((r) => expandedProductIds.has(r.id));

  // Requirement #4: Hierarchical Selection & Tri-state resolution
  const getProductSelectionState = useCallback(
    (product: any): 'all' | 'some' | 'none' => {
      const variants = product.variants || [];
      if (variants.length === 0) {
        return selectedProductIds.has(product.id) ? 'all' : 'none';
      }
      let selectedCount = 0;
      for (const v of variants) {
        if (selectedVariantIds.has(v.id)) selectedCount++;
      }
      if (selectedCount === variants.length && selectedCount > 0) return 'all';
      if (selectedCount > 0) return 'some';
      return selectedProductIds.has(product.id) ? 'all' : 'none';
    },
    [selectedProductIds, selectedVariantIds],
  );

  const toggleProductSelection = useCallback(
    (product: any) => {
      const state = getProductSelectionState(product);
      const variants = product.variants || [];

      setSelectedProductIds((prev) => {
        const next = new Set(prev);
        if (state === 'all') next.delete(product.id);
        else next.add(product.id);
        return next;
      });

      setSelectedVariantIds((prev) => {
        const next = new Set(prev);
        if (state === 'all') {
          variants.forEach((v: any) => next.delete(v.id));
        } else {
          variants.forEach((v: any) => next.add(v.id));
        }
        return next;
      });
    },
    [getProductSelectionState],
  );

  const toggleVariantSelection = useCallback(
    (productId: string, variantId: string) => {
      setSelectedVariantIds((prev) => {
        const next = new Set(prev);
        if (next.has(variantId)) next.delete(variantId);
        else next.add(variantId);

        // Synchronize parent product selection state
        const parent = rows.find((r) => r.id === productId);
        if (parent && parent.variants) {
          const allSelected = parent.variants.every((v: any) =>
            v.id === variantId ? !prev.has(variantId) : next.has(v.id),
          );
          const anySelected = parent.variants.some((v: any) =>
            v.id === variantId ? !prev.has(variantId) : next.has(v.id),
          );

          setSelectedProductIds((prevProd) => {
            const nextProd = new Set(prevProd);
            if (allSelected) nextProd.add(productId);
            else if (!anySelected) nextProd.delete(productId);
            return nextProd;
          });
        }
        return next;
      });
    },
    [rows],
  );

  // Page-level select all state
  const pageSelectionState = useMemo<'all' | 'some' | 'none'>(() => {
    if (rows.length === 0) return 'none';
    let full = 0;
    let partial = 0;
    for (const r of rows) {
      const s = getProductSelectionState(r);
      if (s === 'all') full++;
      else if (s === 'some') partial++;
    }
    if (full === rows.length) return 'all';
    if (full > 0 || partial > 0) return 'some';
    return 'none';
  }, [rows, getProductSelectionState]);

  const toggleSelectAllPage = useCallback(() => {
    if (pageSelectionState === 'all') {
      // Clear page selection
      const pageProductIds = new Set(rows.map((r) => r.id));
      const pageVariantIds = new Set(rows.flatMap((r) => (r.variants || []).map((v: any) => v.id)));

      setSelectedProductIds((prev) => {
        const next = new Set(prev);
        pageProductIds.forEach((id) => next.delete(id));
        return next;
      });
      setSelectedVariantIds((prev) => {
        const next = new Set(prev);
        pageVariantIds.forEach((id) => next.delete(id));
        return next;
      });
    } else {
      // Select all products and all variants on this page
      setSelectedProductIds((prev) => {
        const next = new Set(prev);
        rows.forEach((r) => next.add(r.id));
        return next;
      });
      setSelectedVariantIds((prev) => {
        const next = new Set(prev);
        rows.forEach((r) => {
          (r.variants || []).forEach((v: any) => next.add(v.id));
        });
        return next;
      });
    }
  }, [pageSelectionState, rows]);

  // What "Deactivate selected" will do. A ticked product goes whole only if all
  // its variants are still ticked: a product stays selected for the discount
  // after one variant is unticked, and that variant must not be deactivated.
  const deactivationPlan = useMemo(() => {
    const productIds: string[] = [];
    const variants: { productId: string; variantId: string }[] = [];
    for (const id of selectedProductIds) {
      const known = knownRows.current.get(id)?.variants || [];
      if (known.every((v: any) => selectedVariantIds.has(v.id))) productIds.push(id);
    }
    for (const [productId, row] of knownRows.current) {
      if (productIds.includes(productId)) continue;
      for (const v of row.variants || []) {
        if (selectedVariantIds.has(v.id)) variants.push({ productId, variantId: v.id });
      }
    }
    return { productIds, variants };
  }, [selectedProductIds, selectedVariantIds]);

  const clearAllSelection = () => {
    setSelectedProductIds(new Set());
    setSelectedVariantIds(new Set());
  };

  // Bulk Apply Max Discount
  async function submitBulkApply() {
    const num = Number(bulkValue);
    if (!Number.isFinite(num) || num < 0) {
      toast.error('Enter a valid, non-negative value.');
      return;
    }
    setBulkSaving(true);
    try {
      const payload: any = { productIds: [...selectedProductIds], restrictionType: bulkType };
      if (bulkType === 'MAX_DISCOUNT_PERCENT') payload.maxDiscountPercent = num;
      else payload.maxDiscountAmount = num;
      await bulkApplyMaxDiscount(payload);
      toast.success(`Applied to ${selectedProductIds.size} product(s).`);
      setBulkOpen(false);
      clearAllSelection();
      setBulkValue('');
      fetch();
    } catch (err: any) {
      toast.error(err?.message || 'Could not apply the restriction.');
    } finally {
      setBulkSaving(false);
    }
  }

  // Single Deactivate Product
  async function confirmDelete() {
    if (!confirmDel) return;
    setDelLoading(true);
    try {
      await deleteProduct(confirmDel.id);
      toast.success(`${confirmDel.name} deactivated.`);
      setConfirmDel(null);
      fetch();
      refreshStore();
    } catch (err: any) {
      toast.error(err?.message || 'Could not deactivate product.');
    } finally {
      setDelLoading(false);
    }
  }

  // Deactivate Variant Action
  async function handleConfirmDeleteVariant() {
    if (!confirmDelVariant) return;
    setDelVariantLoading(true);
    try {
      await deleteVariant(confirmDelVariant.product.id, confirmDelVariant.variant.id);
      toast.success(`Variant ${confirmDelVariant.variant.sku || ''} deactivated.`);
      setConfirmDelVariant(null);
      fetch();
      refreshStore();
    } catch (err: any) {
      toast.error(err?.message || 'Could not deactivate variant.');
    } finally {
      setDelVariantLoading(false);
    }
  }

  // Bulk Deactivate (Scoped to selected products and selected variants)
  async function handleBulkDeactivate() {
    setBulkDeactivating(true);
    try {
      for (const prodId of deactivationPlan.productIds) {
        await deleteProduct(prodId);
      }
      for (const { productId, variantId } of deactivationPlan.variants) {
        await deleteVariant(productId, variantId);
      }
      toast.success('Selected products/variants deactivated.');
      setBulkDeactivateOpen(false);
      clearAllSelection();
      fetch();
      refreshStore();
    } catch (err: any) {
      toast.error(err?.message || 'Failed to deactivate some items.');
      // Some may have gone through before the failure, so show the real state.
      fetch();
      refreshStore();
    } finally {
      setBulkDeactivating(false);
    }
  }

  // Construct Table Columns based on visible configuration
  const columns = useMemo<TableColumn[]>(() => {
    const cols: TableColumn[] = [
      // Checkbox Selection Column
      {
        key: 'select',
        header: (
          <TriStateCheckbox
            checked={pageSelectionState === 'all'}
            indeterminate={pageSelectionState === 'some'}
            onChange={toggleSelectAllPage}
            aria-label="Select all on current page"
          />
        ),
        sortable: false,
        width: 38,
        render: (row: any) => {
          const state = getProductSelectionState(row);
          return (
            <TriStateCheckbox
              checked={state === 'all'}
              indeterminate={state === 'some'}
              onChange={() => toggleProductSelection(row)}
              aria-label={`Select ${row.name}`}
            />
          );
        },
      },
      // Expand/Collapse Chevron Column
      {
        key: 'expand',
        header: (
          <button
            type="button"
            onClick={allExpanded ? collapseAll : expandAll}
            className="p-1 rounded text-ink-muted hover:text-ink hover:bg-surface-2 transition"
            title={allExpanded ? 'Collapse all' : 'Expand all'}
            aria-label={allExpanded ? 'Collapse all' : 'Expand all'}
          >
            {allExpanded ? <ChevronsDownUp size={14} /> : <ChevronsUpDown size={14} />}
          </button>
        ),
        sortable: false,
        width: 32,
        render: (row: any) => {
          const isExpanded = expandedProductIds.has(row.id);
          const hasMultipleVariants = Array.isArray(row.variants) && row.variants.length > 0;
          if (!hasMultipleVariants) return null;

          return (
            <button
              type="button"
              onClick={() => toggleExpand(row.id)}
              className="p-1 rounded text-ink-muted hover:text-ink hover:bg-surface-2 transition"
              aria-label={isExpanded ? `Collapse ${row.name}` : `Expand ${row.name}`}
            >
              {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            </button>
          );
        },
      },
    ];

    // Image & Name
    cols.push({
      key: 'product',
      header: 'Product',
      sortable: false,
      render: (row: any) => (
        <div className="flex items-center gap-3">
          {isColumnVisible('image') &&
            (row.imagePath ? (
              <img
                src={fileUrl(row.imagePath)}
                alt={row.name}
                className="h-10 w-10 shrink-0 rounded-md object-cover border border-border"
              />
            ) : (
              <div className="h-10 w-10 shrink-0 rounded-md bg-surface-2 border border-border flex items-center justify-center text-ink-muted">
                <Package size={15} />
              </div>
            ))}
          <div className="min-w-0">
            <p className="font-medium text-ink truncate">
              {highlightText(row.name, search)}
            </p>
            <p className="text-xs text-ink-muted truncate">
              {isColumnVisible('brand') && (
                <>{row.brand ? highlightText(row.brand, search) : '—'} · </>
              )}
              {row.soldBy} · {row.unitLabel}
            </p>
          </div>
        </div>
      ),
    });

    // Category
    if (isColumnVisible('category')) {
      cols.push({
        key: 'category',
        header: 'Category',
        sortable: false,
        render: (row: any) => (
          <span className="text-ink-muted text-xs">{row.categoryPath || '—'}</span>
        ),
      });
    }

    // SKU / Variants Count
    if (isColumnVisible('sku')) {
      cols.push({
        key: 'sku',
        header: 'SKU / Variants',
        sortable: false,
        render: (row: any) =>
          row.hasVariants ? (
            <button
              type="button"
              onClick={() => toggleExpand(row.id)}
              className="inline-flex items-center gap-1 group"
            >
              <Badge tone="accent">
                {row.variantCount} variant{row.variantCount === 1 ? '' : 's'}
              </Badge>
              <span className="text-xs text-accent group-hover:underline">
                {expandedProductIds.has(row.id) ? '▲' : '▼'}
              </span>
            </button>
          ) : (
            <code className="font-mono text-xs text-ink-muted">
              {highlightText(row.variants?.[0]?.sku, search)}
            </code>
          ),
      });
    }

    // Selling Price
    if (isColumnVisible('price')) {
      cols.push({
        key: 'price',
        header: 'Selling',
        align: 'right' as const,
        sortable: false,
        render: (row: any) => {
          if (!row.hasVariants && row.variants?.[0]) {
            return (
              <span className="font-medium text-ink">
                {Number(row.variants[0].sellingPrice || 0).toFixed(2)}{' '}
                <span className="text-[10px] text-ink-muted font-normal">AED</span>
              </span>
            );
          }
          if (row.minPrice !== undefined && row.minPrice === row.maxPrice) {
            return (
              <span className="font-medium text-ink">
                {row.minPrice.toFixed(2)}{' '}
                <span className="text-[10px] text-ink-muted font-normal">AED</span>
              </span>
            );
          }
          if (row.minPrice !== undefined) {
            return (
              <span className="text-ink font-medium text-xs">
                {row.minPrice.toFixed(2)} – {row.maxPrice.toFixed(2)}{' '}
                <span className="text-[10px] text-ink-muted font-normal">AED</span>
              </span>
            );
          }
          return '—';
        },
      });
    }

    // Cost Price (guarded by permission)
    if (canViewCost && isColumnVisible('cost')) {
      cols.push({
        key: 'cost',
        header: 'Total Cost Val.',
        align: 'right' as const,
        sortable: false,
        render: (row: any) =>
          row.totalStockValue !== undefined ? (
            <span className="text-xs text-ink-muted">
              {Number(row.totalStockValue).toFixed(2)}{' '}
              <span className="text-[10px] font-normal">AED</span>
            </span>
          ) : (
            '—'
          ),
      });
    }

    // Pricing Restrictions Column (Requirement #7: Keep Min Price separate from Max Allowed Discount)
    if (isColumnVisible('restrictions')) {
      cols.push({
        key: 'restrictions',
        header: 'Pricing Rules',
        sortable: false,
        render: (row: any) => {
          const r = row.pricingRestriction;
          if (!r || (r.minPrice == null && r.maxDiscountPercent == null && r.maxDiscountAmount == null)) {
            return <span className="text-xs text-ink-muted">—</span>;
          }
          return (
            <div className="flex flex-col gap-1 text-[11px]">
              {r.minPrice != null && (
                <span
                  className="inline-flex items-center rounded bg-surface-2 px-1.5 py-0.5 text-ink font-medium border border-border"
                  title="Absolute floor price cashiers cannot sell below"
                >
                  Floor: AED {Number(r.minPrice).toFixed(2)}
                </span>
              )}
              {r.maxDiscountPercent != null && (
                <span
                  className="inline-flex items-center rounded bg-accent/10 px-1.5 py-0.5 text-accent font-medium border border-accent/20"
                  title="Maximum allowable cashier discount percentage"
                >
                  Max Disc: {r.maxDiscountPercent}%
                </span>
              )}
              {r.maxDiscountAmount != null && (
                <span
                  className="inline-flex items-center rounded bg-accent/10 px-1.5 py-0.5 text-accent font-medium border border-accent/20"
                  title="Maximum allowable cashier discount amount per unit"
                >
                  Max Disc: AED {Number(r.maxDiscountAmount).toFixed(2)}
                </span>
              )}
            </div>
          );
        },
      });
    }

    // Stock Indicator
    if (isColumnVisible('stock')) {
      cols.push({
        key: 'stock',
        header: 'Stock',
        align: 'right' as const,
        sortable: false,
        render: (row: any) => {
          // Stock health check across variants
          const variants = row.variants || [];
          const hasLowStockVariant = variants.some(
            (v: any) =>
              Number(v.reorderThreshold || 0) > 0 &&
              Number(v.stockQty || 0) > 0 &&
              Number(v.stockQty || 0) <= Number(v.reorderThreshold || 0),
          );
          const hasOutOfStockVariant = variants.some(
            (v: any) => Number(v.stockQty || 0) <= 0,
          );

          return (
            <div className="inline-flex flex-col items-end gap-0.5">
              <StockBadge
                qty={row.totalStock}
                threshold={row.reorderThreshold}
                unitLabel={row.unitLabel}
              />
              {row.hasVariants && variants.length > 1 && (
                <span className="text-[10px] text-ink-muted">
                  {hasOutOfStockVariant ? (
                    <span className="text-error font-medium">Some out of stock</span>
                  ) : hasLowStockVariant ? (
                    <span className="text-warning font-medium">Some low stock</span>
                  ) : (
                    `${variants.length} variants`
                  )}
                </span>
              )}
            </div>
          );
        },
      });
    }

    // Status
    if (isColumnVisible('status')) {
      cols.push({
        key: 'status',
        header: 'Status',
        sortable: false,
        render: (row: any) => <StatusBadge active={row.isActive} />,
      });
    }

    // Actions
    cols.push({
      key: 'actions',
      header: '',
      sortable: false,
      align: 'right' as const,
      render: (row: any) => (
        <RowActions
          label={`Actions for ${row.name}`}
          actions={[
            {
              id: 'view',
              label: 'View details',
              icon: <Eye size={14} />,
              onClick: () => router.push(`/products/${row.id}`),
            },
            {
              id: 'edit',
              label: 'Edit product',
              icon: <Pencil size={14} />,
              hidden: !canEditProduct,
              onClick: () => router.push(`/products/${row.id}?edit=1`),
            },
            {
              id: 'deactivate',
              label: 'Deactivate',
              icon: <Trash2 size={14} />,
              tone: 'danger',
              hidden: !canDeleteProduct || !row.isActive,
              onClick: () => setConfirmDel(row),
            },
          ]}
        />
      ),
    });

    return cols;
  }, [
    canViewCost,
    canEditProduct,
    canDeleteProduct,
    isColumnVisible,
    pageSelectionState,
    getProductSelectionState,
    toggleProductSelection,
    toggleSelectAllPage,
    expandedProductIds,
    allExpanded,
    search,
    router,
    rows,
  ]);

  const hasActiveFilters =
    search ||
    filters.categoryId ||
    filters.soldBy ||
    filters.hasVariants ||
    filters.isActive;
  const isEmpty = !loading && rows.length === 0 && !hasActiveFilters;

  const totalSelectedCount = selectedProductIds.size + selectedVariantIds.size;

  return (
    <div>
      <PageHeader
        title="Products"
        subtitle="Product-first catalog with expandable variant inventory and pricing."
        action={
          <div className="flex items-center gap-2">
            <ProductColumnsConfig
              visibleColumns={visibleColumns}
              toggleColumn={toggleColumn}
              resetToDefault={resetToDefault}
              canViewCost={canViewCost}
            />
            <PermissionGate permission="product.create">
              <Button
                leftIcon={<Plus size={16} />}
                onClick={() => router.push('/products/new')}
              >
                Add Product
              </Button>
            </PermissionGate>
          </div>
        }
      />

      <div className="card p-4 mb-4">
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-3">
          <Input
            placeholder="Search by name, SKU or barcode…"
            leftIcon={<Search size={14} />}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            containerClassName="xl:col-span-2"
          />
          <CategoryTreeSelect
            tree={categoriesTree}
            value={filters.categoryId}
            onChange={(id: number | null) => setFilters((f) => ({ ...f, categoryId: id }))}
            allowNone
            noneLabel="All categories"
            placeholder="All categories"
          />
          <Select
            value={filters.soldBy}
            onChange={(v: string) => setFilters((f) => ({ ...f, soldBy: v }))}
            options={SOLD_BY_OPTIONS}
          />
          <Select
            value={filters.hasVariants}
            onChange={(v: string) => setFilters((f) => ({ ...f, hasVariants: v }))}
            options={VARIANT_FILTER}
          />
        </div>
        <div className="mt-3 flex items-center justify-between gap-3">
          <Select
            value={filters.isActive}
            onChange={(v: string) => setFilters((f) => ({ ...f, isActive: v }))}
            options={STATUS_FILTER}
            containerClassName="w-48"
          />
          {hasActiveFilters && (
            <button
              type="button"
              onClick={() => {
                setSearch('');
                setFilters({
                  categoryId: null,
                  soldBy: '',
                  hasVariants: '',
                  isActive: '',
                });
              }}
              className="text-xs text-ink-muted hover:text-ink"
            >
              Clear filters
            </button>
          )}
        </div>
      </div>

      {/* Hierarchical Selection Action Bar */}
      {totalSelectedCount > 0 && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-accent/30 bg-accent-light px-4 py-2.5">
          <div className="flex items-center gap-3">
            <span className="text-sm text-accent font-medium">
              {selectedProductIds.size} product{selectedProductIds.size === 1 ? '' : 's'}
              {selectedVariantIds.size > 0 &&
                ` · ${selectedVariantIds.size} variant${selectedVariantIds.size === 1 ? '' : 's'}`}{' '}
              selected
            </span>
            <button
              type="button"
              onClick={clearAllSelection}
              className="text-xs text-ink-muted hover:text-ink underline"
            >
              Clear selection
            </button>
          </div>

          <div className="flex items-center gap-2">
            {canManagePricingRestrictions && selectedProductIds.size > 0 && (
              <Button size="sm" onClick={() => setBulkOpen(true)}>
                Apply max discount ({selectedProductIds.size})
              </Button>
            )}
            {canDeleteProduct && (
              <Button
                size="sm"
                variant="danger"
                onClick={() => setBulkDeactivateOpen(true)}
              >
                Deactivate selected
              </Button>
            )}
          </div>
        </div>
      )}

      {isEmpty ? (
        <EmptyState
          icon={<Package size={20} />}
          title="No products yet"
          description="Add the first product to your catalog."
          action={
            <PermissionGate permission="product.create">
              <Button
                leftIcon={<Plus size={16} />}
                onClick={() => router.push('/products/new')}
              >
                Add Product
              </Button>
            </PermissionGate>
          }
        />
      ) : (
        <Table
          columns={columns}
          rows={rows}
          loading={loading}
          empty="No products match your filters."
          expandedRowKeys={expandedProductIds}
          renderSubRow={(row) => (
            <VariantSubTable
              product={row}
              variants={row.variants || []}
              searchQuery={search}
              selectedVariantIds={selectedVariantIds}
              onToggleVariant={(vid) => toggleVariantSelection(row.id, vid)}
              canViewCost={canViewCost}
              canEditProduct={canEditProduct}
              canDeleteProduct={canDeleteProduct}
              onEditVariant={(v) => {
                setEditingVariantProduct(row);
                setEditingVariant(v);
                setVariantSlideOverOpen(true);
              }}
              onDeleteVariant={(v) => {
                setConfirmDelVariant({ product: row, variant: v });
              }}
            />
          )}
          pagination={{
            page: meta.page,
            pageSize: meta.limit,
            total: meta.total,
            onPageChange: setPage,
          }}
        />
      )}

      {/* Confirm Deactivate Single Product */}
      <ConfirmDialog
        open={!!confirmDel}
        onClose={() => setConfirmDel(null)}
        title={`Deactivate ${confirmDel?.name}?`}
        description="The product (and all its variants) will be hidden from the POS but kept for sales history."
        confirmLabel="Deactivate"
        variant="danger"
        onConfirm={confirmDelete}
        loading={delLoading}
      />

      {/* Confirm Deactivate Single Variant */}
      <ConfirmDialog
        open={!!confirmDelVariant}
        onClose={() => setConfirmDelVariant(null)}
        title={`Deactivate variant ${confirmDelVariant?.variant?.sku || ''}?`}
        description={`This will deactivate this specific variant of "${confirmDelVariant?.product?.name}". It will be hidden from cashier screens but sales history will be preserved.`}
        confirmLabel="Deactivate variant"
        variant="danger"
        onConfirm={handleConfirmDeleteVariant}
        loading={delVariantLoading}
      />

      {/* Confirm Bulk Deactivate Dialog */}
      <ConfirmDialog
        open={bulkDeactivateOpen}
        onClose={() => setBulkDeactivateOpen(false)}
        title="Deactivate selected items?"
        description={`This will deactivate ${deactivationPlan.productIds.length} whole product(s) and ${deactivationPlan.variants.length} individual variant(s). They will no longer appear on POS screens.`}
        confirmLabel="Deactivate all selected"
        variant="danger"
        onConfirm={handleBulkDeactivate}
        loading={bulkDeactivating}
      />

      {/* Modal: Bulk Apply Max Discount */}
      <Modal
        open={bulkOpen}
        onClose={() => setBulkOpen(false)}
        title="Apply max discount to selected products"
        subtitle={`${selectedProductIds.size} product(s) selected`}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setBulkOpen(false)}>
              Cancel
            </Button>
            <Button onClick={submitBulkApply} disabled={bulkSaving}>
              {bulkSaving ? 'Applying…' : 'Apply'}
            </Button>
          </div>
        }
      >
        <div className="space-y-3">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              checked={bulkType === 'MAX_DISCOUNT_PERCENT'}
              onChange={() => setBulkType('MAX_DISCOUNT_PERCENT')}
            />
            Max discount %
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              checked={bulkType === 'MAX_DISCOUNT_AMOUNT'}
              onChange={() => setBulkType('MAX_DISCOUNT_AMOUNT')}
            />
            Max discount amount (AED per unit)
          </label>
          <Input
            type="number"
            min={0}
            step="0.01"
            value={bulkValue}
            onChange={(e: any) => setBulkValue(e.target.value)}
            placeholder={bulkType === 'MAX_DISCOUNT_PERCENT' ? '%' : 'AED'}
          />
          <p className="text-xs text-ink-muted">
            Sets this cashier discount ceiling on the selected products. Existing minimum price floors on each product remain active and untouched.
          </p>
        </div>
      </Modal>

      {/* SlideOver: Edit Variant directly from table */}
      {editingVariantProduct && (
        <VariantFormSlideOver
          open={variantSlideOverOpen}
          onClose={() => {
            setVariantSlideOverOpen(false);
            setEditingVariant(null);
            setEditingVariantProduct(null);
          }}
          product={editingVariantProduct}
          initialValue={editingVariant}
          showCost={canViewCost}
          onSaved={() => {
            setVariantSlideOverOpen(false);
            setEditingVariant(null);
            setEditingVariantProduct(null);
            toast.success('Variant updated.');
            fetch();
            refreshStore();
          }}
        />
      )}
    </div>
  );
}

export default function ProductsPage() {
  return (
    <RequirePermission permission="product.view">
      <ProductsPageContent />
    </RequirePermission>
  );
}
