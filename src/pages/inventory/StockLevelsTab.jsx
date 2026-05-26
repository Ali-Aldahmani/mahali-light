import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Search,
  Plus,
  History,
  Download,
  Boxes,
  AlertTriangle,
  PackageX,
  Wallet,
} from 'lucide-react';
import Button from '../../components/ui/Button.jsx';
import Input from '../../components/ui/Input.jsx';
import Select from '../../components/ui/Select.jsx';
import Table from '../../components/ui/Table.jsx';
import Badge from '../../components/ui/Badge.jsx';
import StockBadge from '../../components/ui/StockBadge.jsx';
import EmptyState from '../../components/ui/EmptyState.jsx';
import PermissionGate from '../../components/ui/PermissionGate.jsx';
import { useDebouncedValue } from '../../hooks/useDebouncedValue.js';
import { getStockSummary } from '../../services/stockService.js';
import { useProductStore } from '../../store/productStore.js';
import { useInventoryStore } from '../../store/inventoryStore.js';
import { useAuthStore } from '../../store/authStore.js';
import { fileUrl } from '../../config.js';
import { formatQty, formatCurrency } from '../../utils/format.js';
import RequestAdjustmentSlideOver from './RequestAdjustmentSlideOver.jsx';
import StockMovementsDrawer from './StockMovementsDrawer.jsx';
import { onStockUpdate } from '../../store/socketStore.js';

const STATUS_OPTIONS = [
  { value: 'all', label: 'All statuses' },
  { value: 'in_stock', label: 'In stock' },
  { value: 'low_stock', label: 'Low stock' },
  { value: 'out_of_stock', label: 'Out of stock' },
  { value: 'quarantine', label: 'In quarantine' },
];

function toCsv(rows, columns) {
  const header = columns.map((c) => c.label).join(',');
  const body = rows
    .map((r) =>
      columns
        .map((c) => {
          const v = c.value(r) ?? '';
          const s = String(v).replace(/"/g, '""');
          return /[",\n]/.test(s) ? `"${s}"` : s;
        })
        .join(','),
    )
    .join('\n');
  return `${header}\n${body}\n`;
}

function downloadCsv(filename, csv) {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export default function StockLevelsTab() {
  const navigate = useNavigate();
  const permissions = useAuthStore((s) => s.permissions);
  const canRequestAdj = permissions.includes('stock.adjust_request');
  const canSeeCost = permissions.includes('product.view_cost');
  const categoriesFlat = useProductStore((s) => s.categoriesFlat);
  const ensureCats = useProductStore((s) => s.fetchCategories);

  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const [categoryId, setCategoryId] = useState(null);
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState([]);
  const [meta, setMeta] = useState(null);
  const [loading, setLoading] = useState(false);

  const [adjustOpen, setAdjustOpen] = useState(false);
  const [adjustVariant, setAdjustVariant] = useState(null);
  const [movementsOpen, setMovementsOpen] = useState(false);
  const [movementsVariant, setMovementsVariant] = useState(null);

  const debouncedSearch = useDebouncedValue(search, 250);
  const fetchSeq = useRef(0);

  const totalProducts = useInventoryStore((s) => s.totalProducts);
  const lowStockCount = useInventoryStore((s) => s.lowStockCount);
  const outOfStockCount = useInventoryStore((s) => s.outOfStockCount);
  const totalStockValue = useInventoryStore((s) => s.totalStockValue);
  const refreshInventory = useInventoryStore((s) => s.refreshAll);

  useEffect(() => {
    ensureCats?.();
  }, [ensureCats]);

  const fetchData = async () => {
    const seq = ++fetchSeq.current;
    setLoading(true);
    try {
      const res = await getStockSummary({
        page,
        limit: 25,
        search: debouncedSearch || undefined,
        categoryId: categoryId || undefined,
        status,
      });
      if (seq !== fetchSeq.current) return;
      setRows(res?.data || []);
      setMeta(res?.meta || null);
    } finally {
      if (seq === fetchSeq.current) setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, debouncedSearch, categoryId, status]);

  useEffect(() => {
    const unsub = onStockUpdate(() => {
      fetchData();
      refreshInventory();
    });
    return unsub;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const categoryOptions = useMemo(
    () => [
      { value: null, label: 'All categories' },
      ...(categoriesFlat || []).map((c) => ({
        value: c.id,
        label: c.path?.map((p) => p.name).join(' / ') || c.name,
      })),
    ],
    [categoriesFlat],
  );

  const columns = useMemo(() => {
    const cols = [
      {
        key: 'product',
        header: 'Product',
        render: (r) => (
          <div className="flex items-center gap-3 min-w-0">
            <div className="h-10 w-10 rounded bg-surface-2 overflow-hidden flex items-center justify-center text-xs text-ink-muted shrink-0">
              {r.productImage ? (
                <img
                  src={fileUrl(r.productImage)}
                  alt=""
                  className="h-full w-full object-cover"
                />
              ) : (
                '—'
              )}
            </div>
            <div className="min-w-0">
              <button
                type="button"
                onClick={() => navigate(`/products/${r.productId}`)}
                className="text-sm font-medium text-ink hover:text-accent text-left truncate block max-w-[260px]"
                title={r.productName}
              >
                {r.productName}
              </button>
              <div className="text-xs text-ink-muted truncate">
                {r.categoryName || '—'}
              </div>
            </div>
          </div>
        ),
      },
      {
        key: 'sku',
        header: 'SKU / Barcode',
        render: (r) => (
          <div className="text-xs">
            <div className="font-mono text-ink">{r.sku}</div>
            <div className="text-ink-muted">{r.barcode}</div>
          </div>
        ),
      },
      {
        key: 'stock',
        header: 'Stock',
        align: 'right',
        render: (r) => (
          <div className="flex flex-col items-end gap-1">
            <span className="text-sm font-medium">
              {formatQty(r.stockQty)} {r.unitLabel || ''}
            </span>
            {r.quarantineQty > 0 && (
              <Badge tone="muted" size="sm">
                {formatQty(r.quarantineQty)} in quarantine
              </Badge>
            )}
          </div>
        ),
      },
      {
        key: 'threshold',
        header: 'Reorder',
        align: 'right',
        render: (r) =>
          r.reorderThreshold > 0 ? (
            <span className="text-sm">
              {formatQty(r.reorderThreshold)} {r.unitLabel || ''}
            </span>
          ) : (
            <span className="text-xs text-ink-muted">disabled</span>
          ),
      },
    ];
    if (canSeeCost) {
      cols.push({
        key: 'value',
        header: 'Value (cost)',
        align: 'right',
        render: (r) =>
          r.stockValue != null ? (
            <span className="text-sm font-medium">
              {formatCurrency(r.stockValue)}
            </span>
          ) : (
            <span className="text-xs text-ink-muted">—</span>
          ),
      });
    }
    cols.push({
      key: 'status',
      header: 'Status',
      render: (r) => (
        <StockBadge
          qty={r.stockQty}
          threshold={r.reorderThreshold}
          unitLabel={r.unitLabel}
          variant={r.status}
          showQty={false}
          showLabel
          size="sm"
        />
      ),
    });
    cols.push({
      key: 'actions',
      header: '',
      align: 'right',
      render: (r) => (
        <div className="flex items-center justify-end gap-1.5">
          <Button
            size="sm"
            variant="ghost"
            leftIcon={<History className="h-4 w-4" />}
            onClick={(e) => {
              e.stopPropagation();
              setMovementsVariant(r);
              setMovementsOpen(true);
            }}
          >
            Movements
          </Button>
          {canRequestAdj && (
            <Button
              size="sm"
              variant="secondary"
              leftIcon={<Plus className="h-4 w-4" />}
              onClick={(e) => {
                e.stopPropagation();
                setAdjustVariant(r);
                setAdjustOpen(true);
              }}
            >
              Adjust
            </Button>
          )}
        </div>
      ),
    });
    return cols;
  }, [navigate, canSeeCost, canRequestAdj]);

  function handleExport() {
    const cols = [
      { label: 'Product', value: (r) => r.productName },
      { label: 'Category', value: (r) => r.categoryName },
      { label: 'SKU', value: (r) => r.sku },
      { label: 'Barcode', value: (r) => r.barcode },
      { label: 'Stock', value: (r) => r.stockQty },
      { label: 'Quarantine', value: (r) => r.quarantineQty || 0 },
      { label: 'Unit', value: (r) => r.unitLabel || '' },
      { label: 'Reorder threshold', value: (r) => r.reorderThreshold || 0 },
      { label: 'Status', value: (r) => r.status },
    ];
    if (canSeeCost) {
      cols.push(
        { label: 'Cost price', value: (r) => r.costPrice ?? '' },
        { label: 'Stock value', value: (r) => r.stockValue ?? '' },
      );
    }
    downloadCsv(`stock-levels-${new Date().toISOString().slice(0, 10)}.csv`, toCsv(rows, cols));
  }

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-4 gap-4">
        <SummaryCard
          icon={<Boxes className="h-5 w-5" />}
          label="Total products"
          value={totalProducts || 0}
        />
        {canSeeCost && (
          <SummaryCard
            icon={<Wallet className="h-5 w-5" />}
            label="Stock value (cost)"
            value={
              totalStockValue == null ? '—' : formatCurrency(totalStockValue)
            }
          />
        )}
        <SummaryCard
          icon={<AlertTriangle className="h-5 w-5" />}
          label="Low stock"
          value={lowStockCount || 0}
          tone="warning"
        />
        <SummaryCard
          icon={<PackageX className="h-5 w-5" />}
          label="Out of stock"
          value={outOfStockCount || 0}
          tone="error"
        />
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-[260px]">
          <Input
            placeholder="Search by name, SKU, or barcode…"
            leftIcon={<Search className="h-4 w-4" />}
            value={search}
            onChange={(e) => {
              setPage(1);
              setSearch(e.target.value);
            }}
          />
        </div>
        <div className="w-56">
          <Select
            value={categoryId}
            onChange={(v) => {
              setPage(1);
              setCategoryId(v);
            }}
            options={categoryOptions}
            placeholder="All categories"
          />
        </div>
        <div className="w-44">
          <Select
            value={status}
            onChange={(v) => {
              setPage(1);
              setStatus(v);
            }}
            options={STATUS_OPTIONS}
            searchable={false}
          />
        </div>
        <Button
          variant="secondary"
          leftIcon={<Download className="h-4 w-4" />}
          onClick={handleExport}
          disabled={!rows.length}
        >
          Export CSV
        </Button>
        <PermissionGate permission="stock.adjust_request">
          <Button
            leftIcon={<Plus className="h-4 w-4" />}
            onClick={() => {
              setAdjustVariant(null);
              setAdjustOpen(true);
            }}
          >
            Request adjustment
          </Button>
        </PermissionGate>
      </div>

      <Table
        columns={columns}
        rows={rows}
        rowKey={(r) => r.variantId}
        loading={loading}
        empty={
          <EmptyState
            title="No products found"
            description="Try a different search or filter."
          />
        }
        pagination={
          meta
            ? {
                page,
                pageSize: meta.limit || 25,
                total: meta.total || 0,
                onPageChange: setPage,
              }
            : null
        }
      />

      <RequestAdjustmentSlideOver
        open={adjustOpen}
        onClose={() => setAdjustOpen(false)}
        initialVariant={adjustVariant}
        onSuccess={() => {
          fetchData();
          refreshInventory();
        }}
      />

      <StockMovementsDrawer
        open={movementsOpen}
        onClose={() => setMovementsOpen(false)}
        variant={movementsVariant}
      />
    </div>
  );
}

function SummaryCard({ icon, label, value, tone = 'default' }) {
  const TONES = {
    default: 'bg-surface text-ink',
    warning: 'bg-warning-light text-warning',
    error: 'bg-error-light text-error',
    success: 'bg-success-light text-success',
  };
  return (
    <div className="rounded-card border border-border bg-surface p-4 shadow-card flex items-start justify-between">
      <div>
        <div className="text-xs text-ink-muted">{label}</div>
        <div className="text-xl font-semibold text-ink mt-1">{value}</div>
      </div>
      <div className={`h-9 w-9 rounded-md flex items-center justify-center ${TONES[tone]}`}>
        {icon}
      </div>
    </div>
  );
}
