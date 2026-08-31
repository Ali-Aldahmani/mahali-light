import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, Download, History, ArrowLeft } from 'lucide-react';
import PageHeader from '../../components/ui/PageHeader.jsx';
import Button from '../../components/ui/Button.jsx';
import Input from '../../components/ui/Input.jsx';
import Select from '../../components/ui/Select.jsx';
import Table from '../../components/ui/Table.jsx';
import EmptyState from '../../components/ui/EmptyState.jsx';
import MovementTypeBadge, {
  MOVEMENT_TYPES,
  getMovementTypeLabel,
} from '../../components/ui/MovementTypeBadge.jsx';
import { listMovements } from '../../services/stockService.js';
import { useDebouncedValue } from '../../hooks/useDebouncedValue.js';
import { useAuthStore } from '../../store/authStore.js';
import { formatDateTime, formatQty, formatCurrency } from '../../utils/format.js';
import { onStockUpdate } from '../../store/socketStore.js';

const TYPE_FILTERS = [
  { value: 'all', label: 'All types' },
  ...MOVEMENT_TYPES.map((t) => ({ value: t, label: getMovementTypeLabel(t) })),
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

export default function StockMovementsPage() {
  const navigate = useNavigate();
  const permissions = useAuthStore((s) => s.permissions);
  const canSeeCost = permissions.includes('product.view_cost');

  const [search, setSearch] = useState('');
  const [type, setType] = useState('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState([]);
  const [meta, setMeta] = useState(null);
  const [loading, setLoading] = useState(false);

  const debouncedSearch = useDebouncedValue(search, 300);

  const fetchData = async () => {
    setLoading(true);
    try {
      const res = await listMovements({
        page,
        limit: 50,
        search: debouncedSearch || undefined,
        movementType: type === 'all' ? undefined : type,
        dateFrom: dateFrom || undefined,
        dateTo: dateTo || undefined,
      });
      setRows(res?.data || []);
      setMeta(res?.meta || null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, debouncedSearch, type, dateFrom, dateTo]);

  useEffect(() => {
    const unsub = onStockUpdate(() => {
      if (page === 1) fetchData();
    });
    return unsub;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  const columns = useMemo(() => {
    const cols = [
      {
        key: 'timestamp',
        header: 'When',
        render: (r) => (
          <span className="text-xs text-ink-muted">
            {formatDateTime(r.timestamp)}
          </span>
        ),
      },
      {
        key: 'type',
        header: 'Type',
        render: (r) => <MovementTypeBadge type={r.movementType} size="sm" />,
      },
      {
        key: 'product',
        header: 'Product',
        render: (r) => (
          <div className="min-w-0">
            <button
              type="button"
              className="text-sm font-medium text-ink hover:text-accent text-left truncate block max-w-[260px]"
              onClick={() => r.productId && navigate(`/products/${r.productId}`)}
              title={r.productName}
            >
              {r.productName || '—'}
            </button>
            <div className="text-xs text-ink-muted truncate">
              {r.variantSku} {r.variantBarcode ? `· ${r.variantBarcode}` : ''}
            </div>
          </div>
        ),
      },
      {
        key: 'change',
        header: 'Change',
        align: 'right',
        render: (r) => (
          <div className="flex flex-col items-end">
            <span
              className={
                r.quantity > 0
                  ? 'text-success font-semibold'
                  : 'text-error font-semibold'
              }
            >
              {r.quantity > 0 ? '+' : ''}
              {formatQty(r.quantity)} {r.unitLabel || ''}
            </span>
            <span className="text-xs text-ink-muted">
              {formatQty(r.qtyBefore)} → {formatQty(r.qtyAfter)}
            </span>
          </div>
        ),
      },
    ];
    if (canSeeCost) {
      cols.push({
        key: 'value',
        header: 'Value',
        align: 'right',
        render: (r) =>
          r.valueImpact == null ? (
            <span className="text-xs text-ink-muted">—</span>
          ) : (
            <span
              className={
                r.valueImpact > 0
                  ? 'text-success text-sm font-medium'
                  : r.valueImpact < 0
                    ? 'text-error text-sm font-medium'
                    : 'text-sm'
              }
            >
              {r.valueImpact > 0 ? '+' : ''}
              {formatCurrency(r.valueImpact)}
            </span>
          ),
      });
    }
    cols.push({
      key: 'reference',
      header: 'Reference',
      render: (r) =>
        r.referenceType ? (
          <span className="text-xs px-2 py-0.5 rounded-md bg-surface-2 text-ink-muted">
            {r.referenceType}
          </span>
        ) : (
          <span className="text-xs text-ink-muted">—</span>
        ),
    });
    cols.push({
      key: 'employee',
      header: 'By',
      render: (r) => (
        <span className="text-xs text-ink-muted">{r.employeeUsername || 'system'}</span>
      ),
    });
    return cols;
  }, [navigate, canSeeCost]);

  function handleExport() {
    const cols = [
      { label: 'Timestamp', value: (r) => r.timestamp },
      { label: 'Type', value: (r) => getMovementTypeLabel(r.movementType) },
      { label: 'Product', value: (r) => r.productName },
      { label: 'SKU', value: (r) => r.variantSku },
      { label: 'Quantity', value: (r) => r.quantity },
      { label: 'Before', value: (r) => r.qtyBefore },
      { label: 'After', value: (r) => r.qtyAfter },
      { label: 'Unit', value: (r) => r.unitLabel || '' },
      { label: 'Reference', value: (r) => r.referenceType || '' },
      { label: 'Employee', value: (r) => r.employeeUsername || 'system' },
      { label: 'Notes', value: (r) => r.notes || '' },
    ];
    if (canSeeCost) {
      cols.push(
        { label: 'Cost price', value: (r) => r.costPrice ?? '' },
        { label: 'Value impact', value: (r) => r.valueImpact ?? '' },
      );
    }
    downloadCsv(
      `stock-movements-${new Date().toISOString().slice(0, 10)}.csv`,
      toCsv(rows, cols),
    );
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title={
          <span className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              leftIcon={<ArrowLeft className="h-4 w-4" />}
              onClick={() => navigate('/inventory')}
            >
              Back
            </Button>
            <span>Stock movements</span>
          </span>
        }
        subtitle="Full audit log of every stock change in the store."
        action={
          <Button
            variant="secondary"
            leftIcon={<Download className="h-4 w-4" />}
            onClick={handleExport}
            disabled={!rows.length}
          >
            Export CSV
          </Button>
        }
      />

      <div className="grid grid-cols-12 gap-3 items-end">
        <div className="col-span-5">
          <Input
            placeholder="Search by product name, SKU, or barcode…"
            leftIcon={<Search className="h-4 w-4" />}
            value={search}
            onChange={(e) => {
              setPage(1);
              setSearch(e.target.value);
            }}
          />
        </div>
        <div className="col-span-3">
          <Select
            label=""
            value={type}
            onChange={(v) => {
              setPage(1);
              setType(v);
            }}
            options={TYPE_FILTERS}
            searchable={false}
          />
        </div>
        <div className="col-span-2">
          <Input
            label="From"
            type="date"
            value={dateFrom}
            onChange={(e) => {
              setPage(1);
              setDateFrom(e.target.value);
            }}
          />
        </div>
        <div className="col-span-2">
          <Input
            label="To"
            type="date"
            value={dateTo}
            onChange={(e) => {
              setPage(1);
              setDateTo(e.target.value);
            }}
          />
        </div>
      </div>

      <Table
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        loading={loading}
        empty={
          <EmptyState
            title="No movements"
            description="No stock movements match the current filters."
            icon={<History className="h-5 w-5" />}
          />
        }
        pagination={
          meta
            ? {
                page,
                pageSize: meta.limit || 50,
                total: meta.total || 0,
                onPageChange: setPage,
              }
            : null
        }
      />
    </div>
  );
}
