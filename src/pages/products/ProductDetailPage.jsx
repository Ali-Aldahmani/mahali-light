import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft,
  History as HistoryIcon,
  Image as ImageIcon,
  Layers,
  Package,
  Pencil,
  Plus,
  Trash2,
  Warehouse,
} from 'lucide-react';
import PageHeader from '../../components/ui/PageHeader.jsx';
import Button from '../../components/ui/Button.jsx';
import Tabs from '../../components/ui/Tabs.jsx';
import Badge, { StatusBadge } from '../../components/ui/Badge.jsx';
import BarcodeDisplay from '../../components/ui/BarcodeDisplay.jsx';
import StockBadge from '../../components/ui/StockBadge.jsx';
import Spinner from '../../components/ui/Spinner.jsx';
import ConfirmDialog from '../../components/ui/ConfirmDialog.jsx';
import PermissionGate from '../../components/ui/PermissionGate.jsx';
import VariantMatrix from '../../components/ui/VariantMatrix.jsx';
import ImageUpload from '../../components/ui/ImageUpload.jsx';
import ProductEditSlideOver from './ProductEditSlideOver.jsx';
import VariantFormSlideOver from './VariantFormSlideOver.jsx';
import {
  deleteProductImage,
  getProduct,
  getProductHistory,
  uploadProductImage,
} from '../../services/productService.js';
import { deleteVariant } from '../../services/variantService.js';
import { getCategoryAttributes } from '../../services/categoryService.js';
import { getProductWarrantyStats } from '../../services/warrantyService.js';
import { useProductStore } from '../../store/productStore.js';
import { useAuthStore } from '../../store/authStore.js';
import { onProductUpdate } from '../../store/socketStore.js';
import { toast } from '../../store/toastStore.js';
import { fileUrl } from '../../config.js';
import { formatDateTime } from '../../utils/format.js';
import { cn } from '../../utils/cn.js';

export default function ProductDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const canEdit = hasPermission('product.edit');
  const canDelete = hasPermission('product.delete');
  const canViewCost = hasPermission('product.view_cost');

  const tree = useProductStore((s) => s.categoriesTree);
  const fetchCategories = useProductStore((s) => s.fetchCategories);
  const refreshStore = useProductStore((s) => s.refreshAll);

  const [product, setProduct] = useState(null);
  const [categoryAttributes, setCategoryAttributes] = useState([]);
  const [tab, setTab] = useState('overview');
  const [loading, setLoading] = useState(true);

  const [editOpen, setEditOpen] = useState(false);
  const [variantFormOpen, setVariantFormOpen] = useState(false);
  const [editingVariant, setEditingVariant] = useState(null);
  const [confirmDelVariant, setConfirmDelVariant] = useState(null);
  const [history, setHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  const fetch = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getProduct(id);
      setProduct(data);
      if (data?.categoryId) {
        try {
          const attrs = await getCategoryAttributes(data.categoryId);
          setCategoryAttributes(attrs || []);
        } catch (_err) {
          setCategoryAttributes([]);
        }
      } else {
        setCategoryAttributes([]);
      }
    } catch (err) {
      if (err?.code === 'RESOURCE_NOT_FOUND') {
        toast.error('Product not found.');
        navigate('/products');
      } else {
        toast.error(err?.message || 'Failed to load product');
      }
    } finally {
      setLoading(false);
    }
  }, [id, navigate]);

  useEffect(() => {
    fetchCategories();
  }, [fetchCategories]);

  useEffect(() => {
    fetch();
  }, [fetch]);

  // ?edit=1 in URL opens the edit slide-over (used by the Edit button in the list).
  useEffect(() => {
    if (searchParams.get('edit') === '1' && canEdit) {
      setEditOpen(true);
      searchParams.delete('edit');
      setSearchParams(searchParams, { replace: true });
    }
  }, [searchParams, canEdit, setSearchParams]);

  // Realtime refresh when the same product is updated elsewhere.
  useEffect(() => {
    const off = onProductUpdate((payload) => {
      if (payload?.id === id) {
        fetch();
        if (tab === 'history') loadHistory();
      }
    });
    return off;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, tab]);

  const loadHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      const data = await getProductHistory(id);
      setHistory(data || []);
    } catch (err) {
      toast.error(err?.message || 'Could not load history.');
    } finally {
      setHistoryLoading(false);
    }
  }, [id]);

  useEffect(() => {
    if (tab === 'history') loadHistory();
  }, [tab, loadHistory]);

  const tabItems = useMemo(() => {
    const items = [
      { value: 'overview', label: 'Overview', icon: <Package size={14} /> },
    ];
    if (product?.hasVariants) {
      items.push({
        value: 'variants',
        label: 'Variants',
        icon: <Layers size={14} />,
        count: product.variants?.length || 0,
      });
    }
    items.push({ value: 'stock', label: 'Stock', icon: <Warehouse size={14} /> });
    items.push({ value: 'history', label: 'History', icon: <HistoryIcon size={14} /> });
    return items;
  }, [product]);

  async function uploadImage(file) {
    try {
      const updated = await uploadProductImage(id, file);
      setProduct(updated);
      toast.success('Image updated.');
      refreshStore();
    } catch (err) {
      toast.error(err?.message || 'Could not upload image.');
      throw err;
    }
  }

  async function removeImage() {
    try {
      await deleteProductImage(id);
      setProduct((p) => (p ? { ...p, imagePath: null } : p));
      toast.success('Image removed.');
    } catch (err) {
      toast.error(err?.message || 'Could not remove image.');
    }
  }

  async function confirmDeleteVariant() {
    if (!confirmDelVariant) return;
    try {
      await deleteVariant(id, confirmDelVariant.id);
      toast.success('Variant removed.');
      setConfirmDelVariant(null);
      fetch();
    } catch (err) {
      toast.error(err?.message || 'Could not delete variant.');
    }
  }

  if (loading || !product) {
    return (
      <div className="card p-16 flex items-center justify-center">
        <Spinner size="lg" className="text-accent" />
      </div>
    );
  }

  const variants = product.variants || [];
  const totalStock = variants.reduce((a, v) => a + Number(v.stockQty || 0), 0);
  const totalQuarantine = variants.reduce(
    (a, v) => a + Number(v.quarantineQty || 0),
    0,
  );
  const stockValue = canViewCost
    ? variants.reduce(
        (a, v) => a + Number(v.stockQty || 0) * Number(v.costPrice || 0),
        0,
      )
    : null;

  return (
    <div>
      <div className="mb-4">
        <Link to="/products">
          <Button variant="ghost" size="sm" leftIcon={<ArrowLeft size={14} />}>
            Back to products
          </Button>
        </Link>
      </div>

      <PageHeader
        title={
          <span className="inline-flex items-center gap-3">
            {product.name}
            <StatusBadge active={product.isActive} />
            {product.hasVariants && <Badge tone="accent">Variants</Badge>}
          </span>
        }
        subtitle={product.categoryPath || '—'}
        action={
          <>
            <PermissionGate permission="product.edit">
              <Button leftIcon={<Pencil size={14} />} onClick={() => setEditOpen(true)}>
                Edit product
              </Button>
            </PermissionGate>
          </>
        }
      />

      {/* Hero card */}
      <div className="card p-5 mb-4">
        <div className="grid grid-cols-1 md:grid-cols-[180px_1fr] gap-5">
          <div className="flex flex-col items-center">
            {product.imagePath ? (
              <img
                src={fileUrl(product.imagePath)}
                alt={product.name}
                className="h-44 w-44 rounded-card object-cover border border-border bg-surface-2"
              />
            ) : (
              <div className="h-44 w-44 rounded-card bg-surface-2 border border-border flex flex-col items-center justify-center text-ink-muted">
                <ImageIcon size={24} />
                <span className="text-xs mt-1">No image</span>
              </div>
            )}
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-3 text-sm">
            <Field label="Brand">{product.brand || '—'}</Field>
            <Field label="Sold by">
              {product.soldBy}
              <span className="text-ink-muted"> · {product.unitLabel}</span>
            </Field>
            <Field label="Warranty">
              {product.defaultWarrantyMonths
                ? `${product.defaultWarrantyMonths} months`
                : '—'}
            </Field>
            <Field label="Reorder threshold">
              {product.reorderThreshold !== null
                ? Number(product.reorderThreshold).toFixed(2)
                : '—'}
            </Field>
            <Field label="Total stock">
              <StockBadge
                qty={totalStock}
                threshold={product.reorderThreshold}
                unitLabel={product.unitLabel}
              />
            </Field>
            <Field label="Variants">{variants.length}</Field>
          </div>
        </div>
      </div>

      <Tabs items={tabItems} value={tab} onChange={setTab} className="mb-4" />

      {tab === 'overview' && (
        <OverviewTab
          product={product}
          variant={variants[0]}
          canEdit={canEdit}
          canViewCost={canViewCost}
          onUploadImage={uploadImage}
          onRemoveImage={removeImage}
        />
      )}

      {tab === 'variants' && product.hasVariants && (
        <VariantsTab
          product={product}
          variants={variants}
          attributes={categoryAttributes}
          canViewCost={canViewCost}
          canEdit={canEdit}
          canDelete={canDelete}
          onAdd={() => {
            setEditingVariant(null);
            setVariantFormOpen(true);
          }}
          onEdit={(v) => {
            setEditingVariant(v);
            setVariantFormOpen(true);
          }}
          onDelete={(v) => setConfirmDelVariant(v)}
        />
      )}

      {tab === 'stock' && (
        <StockTab
          product={product}
          variants={variants}
          totalStock={totalStock}
          totalQuarantine={totalQuarantine}
          stockValue={stockValue}
          canViewCost={canViewCost}
        />
      )}

      {tab === 'history' && (
        <HistoryTab loading={historyLoading} entries={history} />
      )}

      <ProductEditSlideOver
        open={editOpen}
        onClose={() => setEditOpen(false)}
        product={product}
        tree={tree}
        onSaved={() => {
          fetch();
          refreshStore();
        }}
      />

      <VariantFormSlideOver
        open={variantFormOpen}
        onClose={() => setVariantFormOpen(false)}
        product={product}
        attributes={categoryAttributes}
        initialValue={editingVariant}
        showCost={canViewCost}
        onSaved={fetch}
      />

      <ConfirmDialog
        open={!!confirmDelVariant}
        onClose={() => setConfirmDelVariant(null)}
        title={`Remove variant ${confirmDelVariant?.sku}?`}
        description="The variant will be deactivated and hidden from the POS. Existing sales history is preserved."
        confirmLabel="Remove variant"
        variant="danger"
        onConfirm={confirmDeleteVariant}
      />
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-ink-muted">{label}</p>
      <div className="text-sm text-ink mt-0.5">{children}</div>
    </div>
  );
}

function OverviewTab({
  product,
  variant,
  canEdit,
  canViewCost,
  onUploadImage,
  onRemoveImage,
}) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      <div className="card p-5 lg:col-span-2 space-y-4">
        <h3 className="text-sm font-semibold text-ink">Description</h3>
        {product.description ? (
          <p className="text-sm text-ink-muted whitespace-pre-line">
            {product.description}
          </p>
        ) : (
          <p className="text-sm text-ink-muted/70 italic">No description provided.</p>
        )}

        {!product.hasVariants && variant && (
          <>
            <hr className="border-border" />
            <h3 className="text-sm font-semibold text-ink">Pricing & identifiers</h3>
            <dl className="grid grid-cols-2 md:grid-cols-3 gap-3 text-sm">
              <Field label="SKU">
                <code className="font-mono text-xs">{variant.sku}</code>
              </Field>
              <Field label="Barcode">
                <BarcodeDisplay
                  value={variant.internalBarcode || variant.barcode}
                  label={product.name}
                  size="sm"
                />
              </Field>
              {variant.supplierBarcode && (
                <Field label="Supplier barcode">
                  <code className="font-mono text-xs">{variant.supplierBarcode}</code>
                </Field>
              )}
              <Field label="Selling price">
                <span className="font-semibold text-ink">
                  {Number(variant.sellingPrice || 0).toFixed(2)} AED
                </span>
              </Field>
              {canViewCost && (
                <Field label="Cost price">
                  {Number(variant.costPrice || 0).toFixed(2)} AED
                </Field>
              )}
              <Field label="Stock">
                <StockBadge
                  qty={variant.stockQty}
                  threshold={variant.reorderThreshold || product.reorderThreshold}
                  unitLabel={product.unitLabel}
                />
              </Field>
            </dl>
          </>
        )}
      </div>

      <div className="card p-5 space-y-4">
        <div>
          <h3 className="text-sm font-semibold text-ink mb-3">Image</h3>
          <ImageUpload
            label={null}
            value={product.imagePath}
            onUpload={canEdit ? onUploadImage : undefined}
            onRemove={canEdit ? onRemoveImage : undefined}
            disabled={!canEdit}
          />
        </div>
        <ProductWarrantyStats productId={product.id} />
      </div>
    </div>
  );
}

function ProductWarrantyStats({ productId }) {
  const [stats, setStats] = useState(null);
  useEffect(() => {
    let cancelled = false;
    getProductWarrantyStats(productId)
      .then((s) => {
        if (!cancelled) setStats(s);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [productId]);
  if (!stats) return null;
  const claimRateTone =
    stats.claimRatePct >= 10
      ? 'text-error'
      : stats.claimRatePct >= 5
        ? 'text-warning'
        : 'text-success';
  return (
    <div>
      <h3 className="text-sm font-semibold text-ink mb-3">Warranty insights</h3>
      <div className="grid grid-cols-2 gap-2 text-sm">
        <WarrantyStat label="Active warranties" value={stats.activeCount} />
        <WarrantyStat label="Total claims" value={stats.totalClaims} />
        <WarrantyStat label="Open claims" value={stats.openClaims} tone="warning" />
        <WarrantyStat
          label="Claim rate"
          value={`${stats.claimRatePct}%`}
          tone={
            stats.claimRatePct >= 10
              ? 'error'
              : stats.claimRatePct >= 5
                ? 'warning'
                : 'success'
          }
        />
      </div>
      {stats.mostRecentReason && (
        <div className="mt-3 text-xs text-ink-muted">
          <div className="uppercase tracking-wider text-[10px] mb-0.5">
            Last reported issue
          </div>
          <div className={`line-clamp-2 ${claimRateTone}`}>
            {stats.mostRecentReason}
          </div>
        </div>
      )}
    </div>
  );
}

function WarrantyStat({ label, value, tone = 'neutral' }) {
  const toneClass =
    tone === 'success'
      ? 'text-success'
      : tone === 'warning'
        ? 'text-warning'
        : tone === 'error'
          ? 'text-error'
          : 'text-ink';
  return (
    <div className="rounded-input border border-border bg-surface-2 p-3">
      <div className="text-[11px] uppercase tracking-wider text-ink-muted">
        {label}
      </div>
      <div className={`text-lg font-semibold ${toneClass}`}>{value || 0}</div>
    </div>
  );
}

function VariantsTab({
  product,
  variants,
  attributes,
  canViewCost,
  canEdit,
  canDelete,
  onAdd,
  onEdit,
  onDelete,
}) {
  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <p className="text-sm text-ink-muted">
          {variants.length} active variant{variants.length === 1 ? '' : 's'}
        </p>
        <PermissionGate permission="product.create">
          <Button leftIcon={<Plus size={14} />} onClick={onAdd}>
            Add variant
          </Button>
        </PermissionGate>
      </div>
      <VariantMatrix
        variants={variants}
        attributes={attributes}
        unitLabel={product.unitLabel}
        showCost={canViewCost}
        onEdit={canEdit ? onEdit : undefined}
        onDelete={canDelete ? onDelete : undefined}
      />
    </div>
  );
}

function StockTab({ product, variants, totalStock, totalQuarantine, stockValue, canViewCost }) {
  return (
    <div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
        <Stat label="Total in stock">
          <span className="text-2xl font-semibold text-ink">
            {formatQty(totalStock)} <span className="text-sm font-normal text-ink-muted">{product.unitLabel}</span>
          </span>
        </Stat>
        <Stat label="Quarantined">
          <span className="text-2xl font-semibold text-ink">
            {formatQty(totalQuarantine)} <span className="text-sm font-normal text-ink-muted">{product.unitLabel}</span>
          </span>
        </Stat>
        <Stat label="Reorder threshold">
          <span className="text-2xl font-semibold text-ink">
            {product.reorderThreshold ? formatQty(product.reorderThreshold) : '—'}
          </span>
        </Stat>
      </div>

      {canViewCost && stockValue !== null && (
        <div className="card p-5 mb-4 flex items-center justify-between">
          <div>
            <p className="text-xs uppercase tracking-wide text-ink-muted">
              Stock value at cost
            </p>
            <p className="text-xl font-semibold text-ink mt-0.5">
              {stockValue.toFixed(2)} AED
            </p>
          </div>
          <p className="text-xs text-ink-muted max-w-xs text-right">
            Stock-on-hand × cost price across all variants.
          </p>
        </div>
      )}

      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-surface-2 text-ink-muted">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide">
                Variant
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide">
                Barcode
              </th>
              <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide">
                Stock
              </th>
              <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide">
                Quarantine
              </th>
              <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide">
                Reorder
              </th>
              {canViewCost && (
                <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide">
                  Value (cost)
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {variants.length === 0 && (
              <tr>
                <td colSpan={canViewCost ? 6 : 5} className="px-4 py-10 text-center text-ink-muted">
                  No variants.
                </td>
              </tr>
            )}
            {variants.map((v) => {
              const value = canViewCost
                ? Number(v.stockQty || 0) * Number(v.costPrice || 0)
                : null;
              return (
                <tr key={v.id} className="border-t border-border">
                  <td className="px-4 py-3">
                    <code className="font-mono text-xs text-ink">{v.sku}</code>
                    <div className="text-xs text-ink-muted">
                      {(v.attributes || []).map((a) => a.value).join(' · ') || '—'}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <BarcodeDisplay value={v.internalBarcode || v.barcode} size="sm" />
                  </td>
                  <td className="px-4 py-3 text-right">
                    <StockBadge
                      qty={v.stockQty}
                      threshold={v.reorderThreshold || product.reorderThreshold}
                      unitLabel={product.unitLabel}
                    />
                  </td>
                  <td className="px-4 py-3 text-right text-ink-muted">
                    {formatQty(v.quarantineQty)}
                  </td>
                  <td className="px-4 py-3 text-right text-ink-muted">
                    {v.reorderThreshold != null ? formatQty(v.reorderThreshold) : '—'}
                  </td>
                  {canViewCost && (
                    <td className="px-4 py-3 text-right text-ink">
                      {value !== null ? value.toFixed(2) : '—'}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="mt-3 text-xs text-ink-muted">
        Stock adjustments and quarantine workflows are managed in the Stock module (Phase 3).
      </p>
    </div>
  );
}

function Stat({ label, children }) {
  return (
    <div className="card p-4">
      <p className="text-xs uppercase tracking-wide text-ink-muted">{label}</p>
      <div className="mt-1">{children}</div>
    </div>
  );
}

function HistoryTab({ loading, entries }) {
  if (loading) {
    return (
      <div className="card p-10 flex items-center justify-center">
        <Spinner size="md" className="text-accent" />
      </div>
    );
  }
  if (!entries.length) {
    return (
      <div className="card p-10 text-center text-ink-muted text-sm">
        No history yet.
      </div>
    );
  }
  return (
    <div className="card overflow-hidden">
      <ul className="divide-y divide-border">
        {entries.map((e) => (
          <li key={e.id} className="p-4">
            <div className="flex items-start gap-3">
              <Badge tone={toneForAction(e.action)} size="sm">
                {e.action}
              </Badge>
              <div className="min-w-0 flex-1">
                <p className="text-sm text-ink">
                  <span className="font-medium">{e.performedByUsername || 'system'}</span>{' '}
                  · {formatDateTime(e.timestamp)}
                </p>
                {e.notes && <p className="text-xs text-ink-muted mt-1">{e.notes}</p>}
                {(e.oldValue || e.newValue) && (
                  <details className="mt-2 text-xs text-ink-muted">
                    <summary className="cursor-pointer hover:text-ink">
                      Show diff
                    </summary>
                    <div className="mt-2 grid grid-cols-1 md:grid-cols-2 gap-3">
                      {e.oldValue && (
                        <div>
                          <p className="font-semibold text-ink-muted mb-1">Before</p>
                          <pre className="rounded-md bg-surface-2 p-2 overflow-x-auto text-[11px]">
                            {JSON.stringify(e.oldValue, null, 2)}
                          </pre>
                        </div>
                      )}
                      {e.newValue && (
                        <div>
                          <p className="font-semibold text-ink-muted mb-1">After</p>
                          <pre className="rounded-md bg-surface-2 p-2 overflow-x-auto text-[11px]">
                            {JSON.stringify(e.newValue, null, 2)}
                          </pre>
                        </div>
                      )}
                    </div>
                  </details>
                )}
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function toneForAction(action) {
  if (!action) return 'muted';
  if (action.endsWith('.created')) return 'success';
  if (action.endsWith('.deleted')) return 'error';
  if (action.includes('image')) return 'accent';
  return 'warning';
}

function formatQty(n) {
  const num = Number(n || 0);
  if (Number.isInteger(num)) return String(num);
  return num.toFixed(2).replace(/\.?0+$/, '');
}
