import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Eye, Package, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import PageHeader from '../../components/ui/PageHeader.jsx';
import Button from '../../components/ui/Button.jsx';
import Input from '../../components/ui/Input.jsx';
import Select from '../../components/ui/Select.jsx';
import Table from '../../components/ui/Table.jsx';
import Badge, { StatusBadge } from '../../components/ui/Badge.jsx';
import StockBadge from '../../components/ui/StockBadge.jsx';
import EmptyState from '../../components/ui/EmptyState.jsx';
import ConfirmDialog from '../../components/ui/ConfirmDialog.jsx';
import PermissionGate from '../../components/ui/PermissionGate.jsx';
import CategoryTreeSelect from '../../components/ui/CategoryTreeSelect.jsx';
import { deleteProduct, listProducts } from '../../services/productService.js';
import { useProductStore } from '../../store/productStore.js';
import { useAuthStore } from '../../store/authStore.js';
import { onProductUpdate } from '../../store/socketStore.js';
import { toast } from '../../store/toastStore.js';
import { fileUrl } from '../../config.js';

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

export default function ProductsPage() {
  const navigate = useNavigate();
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const canViewCost = hasPermission('product.view_cost');
  const refreshStore = useProductStore((s) => s.refreshAll);

  const categoriesTree = useProductStore((s) => s.categoriesTree);
  const fetchCategories = useProductStore((s) => s.fetchCategories);

  const [rows, setRows] = useState([]);
  const [meta, setMeta] = useState({ page: 1, limit: 20, total: 0 });
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState({
    categoryId: null,
    soldBy: '',
    hasVariants: '',
    isActive: '',
  });
  const [loading, setLoading] = useState(true);

  const [confirmDel, setConfirmDel] = useState(null);
  const [delLoading, setDelLoading] = useState(false);

  const fetch = useCallback(async () => {
    setLoading(true);
    try {
      const { data, meta: m } = await listProducts({
        page,
        limit: 20,
        search,
        categoryId: filters.categoryId,
        soldBy: filters.soldBy || undefined,
        hasVariants: filters.hasVariants || undefined,
        isActive: filters.isActive || undefined,
      });
      setRows(data || []);
      setMeta(m || { page: 1, limit: 20, total: 0 });
    } catch (err) {
      toast.error(err?.message || 'Failed to load products');
    } finally {
      setLoading(false);
    }
  }, [page, search, filters]);

  useEffect(() => {
    fetchCategories();
  }, [fetchCategories]);

  useEffect(() => {
    fetch();
  }, [fetch]);

  useEffect(() => {
    const id = setTimeout(() => setPage(1), 250);
    return () => clearTimeout(id);
  }, [search, filters]);

  // Real-time refresh from socket.
  useEffect(() => {
    const off = onProductUpdate(() => {
      fetch();
    });
    return off;
  }, [fetch]);

  const columns = useMemo(
    () => [
      {
        key: 'product',
        header: 'Product',
        sortable: false,
        render: (row) => (
          <div className="flex items-center gap-3">
            {row.imagePath ? (
              <img
                src={fileUrl(row.imagePath)}
                alt={row.name}
                className="h-11 w-11 rounded-md object-cover border border-border"
              />
            ) : (
              <div className="h-11 w-11 rounded-md bg-surface-2 border border-border flex items-center justify-center text-ink-muted">
                <Package size={16} />
              </div>
            )}
            <div className="min-w-0">
              <p className="font-medium text-ink truncate">{row.name}</p>
              <p className="text-xs text-ink-muted truncate">
                {row.brand || '—'} · {row.soldBy} · {row.unitLabel}
              </p>
            </div>
          </div>
        ),
      },
      {
        key: 'category',
        header: 'Category',
        sortable: false,
        render: (row) => (
          <span className="text-ink-muted text-xs">{row.categoryPath || '—'}</span>
        ),
      },
      {
        key: 'sku',
        header: 'SKU / Variants',
        sortable: false,
        render: (row) =>
          row.hasVariants ? (
            <Badge tone="accent">{row.variantCount} variants</Badge>
          ) : (
            <code className="font-mono text-xs text-ink-muted">
              {row.variants?.[0]?.sku || '—'}
            </code>
          ),
      },
      {
        key: 'price',
        header: 'Selling',
        align: 'right',
        sortable: false,
        render: (row) => {
          if (!row.hasVariants && row.variants?.[0]) {
            return (
              <span className="font-medium text-ink">
                {Number(row.variants[0].sellingPrice || 0).toFixed(2)}
              </span>
            );
          }
          if (row.minPrice !== undefined && row.minPrice === row.maxPrice) {
            return (
              <span className="font-medium text-ink">{row.minPrice.toFixed(2)}</span>
            );
          }
          if (row.minPrice !== undefined) {
            return (
              <span className="text-ink-muted text-xs">
                {row.minPrice.toFixed(2)} – {row.maxPrice.toFixed(2)}
              </span>
            );
          }
          return '—';
        },
      },
      {
        key: 'stock',
        header: 'Stock',
        align: 'right',
        sortable: false,
        render: (row) => (
          <StockBadge
            qty={row.totalStock}
            threshold={row.reorderThreshold}
            unitLabel={row.unitLabel}
          />
        ),
      },
      {
        key: 'status',
        header: 'Status',
        sortable: false,
        render: (row) => <StatusBadge active={row.isActive} />,
      },
      {
        key: 'actions',
        header: '',
        sortable: false,
        align: 'right',
        render: (row) => (
          <div
            className="flex items-center justify-end gap-1"
            onClick={(e) => e.stopPropagation()}
          >
            <Button
              variant="ghost"
              size="sm"
              leftIcon={<Eye size={13} />}
              onClick={() => navigate(`/products/${row.id}`)}
            >
              View
            </Button>
            <PermissionGate permission="product.edit">
              <Button
                variant="ghost"
                size="sm"
                leftIcon={<Pencil size={13} />}
                onClick={() => navigate(`/products/${row.id}?edit=1`)}
              >
                Edit
              </Button>
            </PermissionGate>
            <PermissionGate permission="product.delete">
              {row.isActive && (
                <Button
                  variant="ghost"
                  size="sm"
                  leftIcon={<Trash2 size={13} />}
                  className="text-error hover:bg-error-light"
                  onClick={() => setConfirmDel(row)}
                >
                  Deactivate
                </Button>
              )}
            </PermissionGate>
          </div>
        ),
      },
    ],
    [navigate, canViewCost],
  );

  async function confirmDelete() {
    if (!confirmDel) return;
    setDelLoading(true);
    try {
      await deleteProduct(confirmDel.id);
      toast.success(`${confirmDel.name} deactivated.`);
      setConfirmDel(null);
      fetch();
      refreshStore();
    } catch (err) {
      toast.error(err?.message || 'Could not deactivate product.');
    } finally {
      setDelLoading(false);
    }
  }

  const hasActiveFilters =
    search ||
    filters.categoryId ||
    filters.soldBy ||
    filters.hasVariants ||
    filters.isActive;
  const isEmpty = !loading && rows.length === 0 && !hasActiveFilters;

  return (
    <div>
      <PageHeader
        title="Products"
        subtitle="Your catalog of items and variants."
        action={
          <PermissionGate permission="product.create">
            <Button
              leftIcon={<Plus size={16} />}
              onClick={() => navigate('/products/new')}
            >
              Add Product
            </Button>
          </PermissionGate>
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
            onChange={(id) => setFilters((f) => ({ ...f, categoryId: id }))}
            allowNone
            noneLabel="All categories"
            placeholder="All categories"
          />
          <Select
            value={filters.soldBy}
            onChange={(v) => setFilters((f) => ({ ...f, soldBy: v }))}
            options={SOLD_BY_OPTIONS}
          />
          <Select
            value={filters.hasVariants}
            onChange={(v) => setFilters((f) => ({ ...f, hasVariants: v }))}
            options={VARIANT_FILTER}
          />
        </div>
        <div className="mt-3 flex items-center justify-between gap-3">
          <Select
            value={filters.isActive}
            onChange={(v) => setFilters((f) => ({ ...f, isActive: v }))}
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

      {isEmpty ? (
        <EmptyState
          icon={<Package size={20} />}
          title="No products yet"
          description="Add the first product to your catalog."
          action={
            <PermissionGate permission="product.create">
              <Button
                leftIcon={<Plus size={16} />}
                onClick={() => navigate('/products/new')}
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
          onRowClick={(row) => navigate(`/products/${row.id}`)}
          pagination={{
            page: meta.page,
            pageSize: meta.limit,
            total: meta.total,
            onPageChange: setPage,
          }}
        />
      )}

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
    </div>
  );
}
