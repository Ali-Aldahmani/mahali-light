'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
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
import PageHeader from '@/components/ui/PageHeader';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import Select from '@/components/ui/Select';
import Table, { type TableColumn } from '@/components/ui/Table';
import EmptyState from '@/components/ui/EmptyState';
import PermissionGate from '@/components/ui/PermissionGate';
import InvoiceStatusBadge from '@/components/ui/InvoiceStatusBadge';
import PaymentStatusBadge from '@/components/ui/PaymentStatusBadge';
import RequirePermission from '@/components/guards/RequirePermission';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { useAuthStore } from '@/store/authStore';
import { useInvoiceStore } from '@/store/invoiceStore';
import { onInvoiceEvent } from '@/store/socketStore';
import { listInvoices } from '@/services/invoiceService';
import { formatCurrency, formatDateTime } from '@/lib/utils/format';

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
  return (
    <RequirePermission permission="invoice.view">
      <InvoicesPageContent />
    </RequirePermission>
  );
}

function InvoicesPageContent() {
  const router = useRouter();
  const permissions = useAuthStore((s) => s.permissions);
  const canCreate = permissions.includes('invoice.create');

  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [paymentStatus, setPaymentStatus] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<any[]>([]);
  const [meta, setMeta] = useState<any>(null);
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

  const columns = useMemo<TableColumn[]>(
    () => [
      {
        key: 'invoiceNumber',
        header: 'Invoice',
        render: (r: any) => (
          <button
            type="button"
            onClick={() => router.push(`/invoices/${r.id}`)}
            className="font-mono text-sm text-ink hover:text-accent text-left"
          >
            {r.invoiceNumber}
          </button>
        ),
      },
      {
        key: 'customer',
        header: 'Customer',
        render: (r: any) => (
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
        render: (r: any) => (
          <div className="text-xs text-ink-muted">
            {formatDateTime(r.createdAt)}
          </div>
        ),
      },
      {
        key: 'itemCount',
        header: 'Items',
        align: 'right' as const,
        render: (r: any) => r.itemCount || 0,
      },
      {
        key: 'total',
        header: 'Total',
        align: 'right' as const,
        render: (r: any) => (
          <span className="font-medium text-ink">
            {formatCurrency(r.total)}
          </span>
        ),
      },
      {
        key: 'amountPaid',
        header: 'Paid',
        align: 'right' as const,
        render: (r: any) => formatCurrency(r.amountPaid),
      },
      {
        key: 'balanceDue',
        header: 'Balance',
        align: 'right' as const,
        render: (r: any) => (
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
        render: (r: any) => <PaymentStatusBadge status={r.paymentStatus} size="sm" />,
      },
      {
        key: 'status',
        header: 'Status',
        render: (r: any) => <InvoiceStatusBadge status={r.status} size="sm" />,
      },
      {
        key: 'createdBy',
        header: 'By',
        render: (r: any) => (
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
        align: 'right' as const,
        sortable: false,
        render: (r: any) => (
          <Button
            size="sm"
            variant="ghost"
            leftIcon={<Eye className="h-4 w-4" />}
            onClick={(e: any) => {
              e.stopPropagation();
              router.push(`/invoices/${r.id}`);
            }}
          >
            View
          </Button>
        ),
      },
    ],
    [router],
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
              onClick={() => router.push('/pos')}
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
            onChange={(e: any) => {
              setPage(1);
              setSearch(e.target.value);
            }}
          />
        </div>
        <div className="w-40">
          <Select
            value={status}
            onChange={(v: any) => {
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
            onChange={(v: any) => {
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
            onChange={(e: any) => {
              setPage(1);
              setDateFrom(e.target.value);
            }}
          />
        </div>
        <div className="w-40">
          <Input
            type="date"
            value={dateTo}
            onChange={(e: any) => {
              setPage(1);
              setDateTo(e.target.value);
            }}
          />
        </div>
      </div>

      <Table
        columns={columns}
        rows={rows}
        rowKey={(r: any) => r.id}
        loading={loading}
        onRowClick={(r: any) => router.push(`/invoices/${r.id}`)}
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

function SummaryCard({
  icon,
  label,
  value,
  tone = 'default',
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
  tone?: 'default' | 'warning' | 'error' | 'success';
}) {
  const TONES: Record<string, string> = {
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
