import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Plus,
  Search,
  Receipt,
  Wallet,
  TrendingUp,
  Calendar,
  Eye,
  ShoppingCart,
} from 'lucide-react';
import PageHeader from '../../components/ui/PageHeader.jsx';
import Button from '../../components/ui/Button.jsx';
import Input from '../../components/ui/Input.jsx';
import Select from '../../components/ui/Select.jsx';
import Table from '../../components/ui/Table.jsx';
import EmptyState from '../../components/ui/EmptyState.jsx';
import PermissionGate from '../../components/ui/PermissionGate.jsx';
import InvoiceStatusBadge from '../../components/ui/InvoiceStatusBadge.jsx';
import PaymentStatusBadge from '../../components/ui/PaymentStatusBadge.jsx';
import { useDebouncedValue } from '../../hooks/useDebouncedValue.js';
import { useAuthStore } from '../../store/authStore.js';
import { useInvoiceStore } from '../../store/invoiceStore.js';
import { onInvoiceEvent } from '../../store/socketStore.js';
import { listInvoices } from '../../services/invoiceService.js';
import { formatCurrency, formatDateTime } from '../../utils/format.js';

const STATUS_OPTIONS = [
  { value: '', label: 'All statuses' },
  { value: 'draft', label: 'Draft' },
  { value: 'confirmed', label: 'Confirmed' },
  { value: 'cancelled', label: 'Cancelled' },
  { value: 'refunded', label: 'Refunded' },
];
const PAYMENT_OPTIONS = [
  { value: '', label: 'All payment status' },
  { value: 'unpaid', label: 'Unpaid' },
  { value: 'partial', label: 'Partial' },
  { value: 'paid', label: 'Paid' },
];

export default function InvoicesPage() {
  const navigate = useNavigate();
  const permissions = useAuthStore((s) => s.permissions);
  const canCreate = permissions.includes('invoice.create');

  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [paymentStatus, setPaymentStatus] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState([]);
  const [meta, setMeta] = useState(null);
  const [loading, setLoading] = useState(false);

  const debouncedSearch = useDebouncedValue(search, 250);
  const fetchSeq = useRef(0);

  const refreshSummary = useInvoiceStore((s) => s.refreshSummary);

  async function fetchData() {
    const seq = ++fetchSeq.current;
    setLoading(true);
    try {
      const res = await listInvoices({
        page,
        limit: 25,
        search: debouncedSearch || undefined,
        status: status || undefined,
        paymentStatus: paymentStatus || undefined,
        dateFrom: dateFrom || undefined,
        dateTo: dateTo || undefined,
      });
      if (seq !== fetchSeq.current) return;
      setRows(res?.data || []);
      setMeta(res?.meta || null);
    } finally {
      if (seq === fetchSeq.current) setLoading(false);
    }
  }

  useEffect(() => {
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, debouncedSearch, status, paymentStatus, dateFrom, dateTo]);

  useEffect(() => {
    refreshSummary?.();
  }, [refreshSummary]);

  useEffect(() => {
    return onInvoiceEvent(() => {
      fetchData();
      refreshSummary?.();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const summary = meta?.totals;

  const columns = useMemo(
    () => [
      {
        key: 'invoiceNumber',
        header: 'Invoice',
        render: (r) => (
          <button
            type="button"
            onClick={() => navigate(`/invoices/${r.id}`)}
            className="font-mono text-sm text-ink hover:text-accent text-left"
          >
            {r.invoiceNumber}
          </button>
        ),
      },
      {
        key: 'customer',
        header: 'Customer',
        render: (r) => (
          <div className="min-w-0">
            <div className="text-sm text-ink truncate max-w-[220px]">
              {r.customerName || 'Guest'}
            </div>
            {r.customerCompany && (
              <div className="text-xs text-ink-muted truncate max-w-[220px]">
                {r.customerCompany}
              </div>
            )}
          </div>
        ),
      },
      {
        key: 'createdAt',
        header: 'Date',
        render: (r) => (
          <div className="text-xs text-ink-muted">
            {formatDateTime(r.createdAt)}
          </div>
        ),
      },
      {
        key: 'itemCount',
        header: 'Items',
        align: 'right',
        render: (r) => r.itemCount || 0,
      },
      {
        key: 'total',
        header: 'Total',
        align: 'right',
        render: (r) => (
          <span className="font-medium text-ink">
            {formatCurrency(r.total)}
          </span>
        ),
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
          <span
            className={r.balanceDue > 0 ? 'text-accent font-medium' : ''}
          >
            {formatCurrency(r.balanceDue)}
          </span>
        ),
      },
      {
        key: 'paymentStatus',
        header: 'Payment',
        render: (r) => <PaymentStatusBadge status={r.paymentStatus} size="sm" />,
      },
      {
        key: 'status',
        header: 'Status',
        render: (r) => <InvoiceStatusBadge status={r.status} size="sm" />,
      },
      {
        key: 'createdBy',
        header: 'By',
        render: (r) => (
          <span className="text-xs text-ink-muted">
            {r.createdByUsername || '—'}
            {r.pcIdentifier && (
              <span className="ml-1 text-ink-muted/70">· {r.pcIdentifier}</span>
            )}
          </span>
        ),
      },
      {
        key: 'actions',
        header: '',
        align: 'right',
        sortable: false,
        render: (r) => (
          <Button
            size="sm"
            variant="ghost"
            leftIcon={<Eye className="h-4 w-4" />}
            onClick={(e) => {
              e.stopPropagation();
              navigate(`/invoices/${r.id}`);
            }}
          >
            View
          </Button>
        ),
      },
    ],
    [navigate],
  );

  return (
    <div className="space-y-5">
      <PageHeader
        title="Invoices"
        subtitle="Sales receipts, payments, and edit requests."
        action={
          <PermissionGate permission="invoice.create">
            <Button
              leftIcon={<ShoppingCart className="h-4 w-4" />}
              onClick={() => navigate('/pos')}
            >
              New sale
            </Button>
          </PermissionGate>
        }
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <SummaryCard
          icon={<TrendingUp className="h-5 w-5" />}
          label="Today's revenue"
          value={formatCurrency(summary?.revenueToday || 0)}
          tone="success"
        />
        <SummaryCard
          icon={<Receipt className="h-5 w-5" />}
          label="Today's invoices"
          value={summary?.invoicesToday ?? 0}
        />
        <SummaryCard
          icon={<Wallet className="h-5 w-5" />}
          label="Outstanding"
          value={formatCurrency(summary?.outstanding || 0)}
          tone={summary?.outstanding > 0 ? 'warning' : 'default'}
        />
        <SummaryCard
          icon={<Calendar className="h-5 w-5" />}
          label="This month"
          value={formatCurrency(summary?.revenueMonth || 0)}
        />
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-[260px]">
          <Input
            placeholder="Search by invoice # or customer name/phone"
            leftIcon={<Search className="h-4 w-4" />}
            value={search}
            onChange={(e) => {
              setPage(1);
              setSearch(e.target.value);
            }}
          />
        </div>
        <div className="w-40">
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
        <div className="w-44">
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
        <div className="w-40">
          <Input
            type="date"
            value={dateFrom}
            onChange={(e) => {
              setPage(1);
              setDateFrom(e.target.value);
            }}
          />
        </div>
        <div className="w-40">
          <Input
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
        onRowClick={(r) => navigate(`/invoices/${r.id}`)}
        empty={
          <EmptyState
            title="No invoices"
            description={
              canCreate
                ? 'Start a new sale to record your first invoice.'
                : 'No invoices match the current filters.'
            }
            icon={<Receipt className="h-6 w-6" />}
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
      <div
        className={`h-9 w-9 rounded-md flex items-center justify-center ${TONES[tone]}`}
      >
        {icon}
      </div>
    </div>
  );
}
