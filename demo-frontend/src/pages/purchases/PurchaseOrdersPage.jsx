import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Plus,
  Search,
  FileText,
  Wallet,
  AlertCircle,
  Calendar,
} from 'lucide-react';
import PageHeader from '../../components/ui/PageHeader.jsx';
import Button from '../../components/ui/Button.jsx';
import Input from '../../components/ui/Input.jsx';
import Select from '../../components/ui/Select.jsx';
import Table from '../../components/ui/Table.jsx';
import EmptyState from '../../components/ui/EmptyState.jsx';
import PermissionGate from '../../components/ui/PermissionGate.jsx';
import POStatusBadge from '../../components/ui/POStatusBadge.jsx';
import PaymentStatusBadge from '../../components/ui/PaymentStatusBadge.jsx';
import SupplierSelect from '../../components/ui/SupplierSelect.jsx';
import { useDebouncedValue } from '../../hooks/useDebouncedValue.js';
import { useAuthStore } from '../../store/authStore.js';
import { useSupplierStore } from '../../store/supplierStore.js';
import { listPurchaseOrders } from '../../services/purchaseOrderService.js';
import { formatCurrency, formatDate } from '../../utils/format.js';
import { onPurchaseOrderEvent } from '../../store/socketStore.js';

const STATUS_OPTIONS = [
  { value: '', label: 'All statuses' },
  { value: 'draft', label: 'Draft' },
  { value: 'confirmed', label: 'Confirmed' },
  { value: 'partially_received', label: 'Partially received' },
  { value: 'received', label: 'Received' },
  { value: 'cancelled', label: 'Cancelled' },
];

const PAYMENT_OPTIONS = [
  { value: '', label: 'All payments' },
  { value: 'unpaid', label: 'Unpaid' },
  { value: 'partial', label: 'Partial' },
  { value: 'paid', label: 'Paid' },
];

export default function PurchaseOrdersPage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const permissions = useAuthStore((s) => s.permissions);
  const canSeeCost = permissions.includes('product.view_cost');

  const [search, setSearch] = useState(params.get('search') || '');
  const [supplier, setSupplier] = useState(null);
  const [status, setStatus] = useState(params.get('status') || '');
  const [paymentStatus, setPaymentStatus] = useState(
    params.get('paymentStatus') || '',
  );
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [overdue, setOverdue] = useState(params.get('overdue') === 'true');
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState([]);
  const [meta, setMeta] = useState(null);
  const [loading, setLoading] = useState(false);

  const debouncedSearch = useDebouncedValue(search, 250);
  const fetchSeq = useRef(0);

  const refreshSummary = useSupplierStore((s) => s.refreshSummary);

  const fetchData = async () => {
    const seq = ++fetchSeq.current;
    setLoading(true);
    try {
      const res = await listPurchaseOrders({
        page,
        limit: 25,
        search: debouncedSearch || undefined,
        supplierId: supplier?.id || undefined,
        status: status || undefined,
        paymentStatus: paymentStatus || undefined,
        dateFrom: dateFrom || undefined,
        dateTo: dateTo || undefined,
        overdue: overdue ? 'true' : undefined,
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
  }, [
    page,
    debouncedSearch,
    supplier?.id,
    status,
    paymentStatus,
    dateFrom,
    dateTo,
    overdue,
  ]);

  useEffect(() => {
    refreshSummary?.();
  }, [refreshSummary]);

  useEffect(() => {
    return onPurchaseOrderEvent(() => {
      fetchData();
      refreshSummary?.();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist a few filters in the URL for shareable links.
  useEffect(() => {
    const next = {};
    if (status) next.status = status;
    if (paymentStatus) next.paymentStatus = paymentStatus;
    if (overdue) next.overdue = 'true';
    if (search) next.search = search;
    setParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, paymentStatus, overdue, search]);

  const totals = meta?.totals;

  const columns = useMemo(
    () => [
      {
        key: 'poNumber',
        header: 'PO #',
        render: (r) => (
          <div
            className={`pl-2 -ml-2 ${
              isOverdueRow(r) ? 'border-l-2 border-error' : ''
            }`}
          >
            <button
              type="button"
              onClick={() => navigate(`/purchase-orders/${r.id}`)}
              className="text-sm font-medium text-ink hover:text-accent"
            >
              {r.poNumber}
            </button>
          </div>
        ),
      },
      {
        key: 'supplierName',
        header: 'Supplier',
        render: (r) => (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              navigate(`/suppliers/${r.supplierId}`);
            }}
            className="text-sm text-ink hover:text-accent"
          >
            {r.supplierName}
          </button>
        ),
      },
      {
        key: 'orderDate',
        header: 'Date',
        render: (r) => formatDate(r.orderDate),
      },
      { key: 'itemsCount', header: 'Items', align: 'right' },
      ...(canSeeCost
        ? [
            {
              key: 'totalCost',
              header: 'Total',
              align: 'right',
              render: (r) => formatCurrency(r.totalCost),
            },
            {
              key: 'amountPaid',
              header: 'Paid',
              align: 'right',
              render: (r) => formatCurrency(r.amountPaid),
            },
            {
              key: 'balanceDue',
              header: 'Balance',
              align: 'right',
              render: (r) => (
                <span className={r.balanceDue > 0 ? 'text-accent font-medium' : ''}>
                  {formatCurrency(r.balanceDue)}
                </span>
              ),
            },
          ]
        : []),
      {
        key: 'dueDate',
        header: 'Due',
        render: (r) =>
          r.dueDate ? (
            <span className={isOverdueRow(r) ? 'text-error' : ''}>
              {formatDate(r.dueDate)}
            </span>
          ) : (
            '—'
          ),
      },
      {
        key: 'status',
        header: 'Status',
        render: (r) => (
          <div className="flex items-center gap-1.5">
            <POStatusBadge status={r.status} size="sm" />
            <PaymentStatusBadge status={r.paymentStatus} size="sm" />
          </div>
        ),
      },
    ],
    [canSeeCost, navigate],
  );

  function isOverdueRow(r) {
    return (
      r.dueDate &&
      new Date(r.dueDate) < new Date() &&
      r.paymentStatus !== 'paid' &&
      r.status !== 'cancelled'
    );
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Purchase orders"
        subtitle="Issue, receive, and reconcile every PO with full audit history."
        action={
          <PermissionGate permission="supplier.purchase_order.create">
            <Button
              leftIcon={<Plus className="h-4 w-4" />}
              onClick={() => navigate('/purchase-orders/new')}
            >
              New PO
            </Button>
          </PermissionGate>
        }
      />

      <div className="grid grid-cols-4 gap-4">
        <SummaryCard
          icon={<FileText className="h-5 w-5" />}
          label="Total POs"
          value={totals?.totalPos ?? '—'}
        />
        <SummaryCard
          icon={<Wallet className="h-5 w-5" />}
          label="Pending payment"
          value={formatCurrency(totals?.pendingPayment ?? 0)}
        />
        <SummaryCard
          icon={<AlertCircle className="h-5 w-5" />}
          label="Overdue"
          value={
            totals?.overdueAmount != null
              ? formatCurrency(totals.overdueAmount)
              : totals?.overdueCount ?? 0
          }
          tone={totals?.overdueCount > 0 ? 'error' : 'default'}
        />
        <SummaryCard
          icon={<Calendar className="h-5 w-5" />}
          label="This month spent"
          value={
            totals?.thisMonthSpent != null
              ? formatCurrency(totals.thisMonthSpent)
              : '—'
          }
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-6 gap-3">
        <div className="md:col-span-2">
          <Input
            placeholder="Search PO number or supplier…"
            leftIcon={<Search className="h-4 w-4" />}
            value={search}
            onChange={(e) => {
              setPage(1);
              setSearch(e.target.value);
            }}
          />
        </div>
        <div className="md:col-span-1">
          <SupplierSelect
            label={null}
            value={supplier}
            onChange={(s) => {
              setPage(1);
              setSupplier(s);
            }}
            showOutstanding={false}
            placeholder="Filter by supplier"
          />
        </div>
        <div>
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
        <div>
          <Select
            value={paymentStatus}
            onChange={(v) => {
              setPage(1);
              setPaymentStatus(v);
            }}
            options={PAYMENT_OPTIONS}
            searchable={false}
          />
        </div>
        <div className="flex items-center gap-1">
          <Input
            type="date"
            value={dateFrom}
            onChange={(e) => {
              setPage(1);
              setDateFrom(e.target.value);
            }}
          />
        </div>
      </div>

      <div className="flex items-center gap-3">
        <label className="inline-flex items-center gap-2 text-sm text-ink">
          <input
            type="checkbox"
            checked={overdue}
            onChange={(e) => {
              setPage(1);
              setOverdue(e.target.checked);
            }}
            className="h-4 w-4 rounded border-border text-accent focus:ring-accent"
          />
          Overdue only
        </label>
        <Input
          type="date"
          value={dateTo}
          onChange={(e) => {
            setPage(1);
            setDateTo(e.target.value);
          }}
          containerClassName="w-44"
          placeholder="Date to"
        />
      </div>

      <Table
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        loading={loading}
        onRowClick={(r) => navigate(`/purchase-orders/${r.id}`)}
        empty={
          <EmptyState
            title="No purchase orders"
            description="Create a PO from the suppliers list or from this page."
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
