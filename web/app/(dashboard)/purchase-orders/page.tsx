'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import {
  Plus,
  Search,
  FileText,
  Wallet,
  AlertCircle,
  Calendar,
} from 'lucide-react';
import PageHeader from '@/components/ui/PageHeader';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import Select from '@/components/ui/Select';
import Table, { type TableColumn } from '@/components/ui/Table';
import EmptyState from '@/components/ui/EmptyState';
import PermissionGate from '@/components/ui/PermissionGate';
import POStatusBadge from '@/components/ui/POStatusBadge';
import PaymentStatusBadge from '@/components/ui/PaymentStatusBadge';
import SupplierSelect from '@/components/ui/SupplierSelect';
import RequirePermission from '@/components/guards/RequirePermission';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { useAuthStore } from '@/store/authStore';
import { useSupplierStore } from '@/store/supplierStore';
import { listPurchaseOrders } from '@/services/purchaseOrderService';
import { formatCurrency, formatDate } from '@/lib/utils/format';
import { onPurchaseOrderEvent } from '@/store/socketStore';
import type {
  PurchaseOrder,
  PurchaseOrderListMeta,
} from '@/components/purchases/types';
import type { Supplier } from '@/components/suppliers/types';

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

function isOverdueRow(r: PurchaseOrder) {
  return (
    r.dueDate &&
    new Date(r.dueDate) < new Date() &&
    r.paymentStatus !== 'paid' &&
    r.status !== 'cancelled'
  );
}

function PurchaseOrdersPageContent() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function updateParams(patch: Record<string, string | null>) {
    const next = new URLSearchParams(searchParams.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v === null) next.delete(k);
      else next.set(k, v);
    }
    router.replace(`${pathname}?${next.toString()}`);
  }

  const permissions = useAuthStore((s: any) => s.permissions);
  const canSeeCost = permissions.includes('product.view_cost');

  const [search, setSearch] = useState(searchParams.get('search') || '');
  const [supplier, setSupplier] = useState<Supplier | null>(null);
  const [status, setStatus] = useState(searchParams.get('status') || '');
  const [paymentStatus, setPaymentStatus] = useState(
    searchParams.get('paymentStatus') || '',
  );
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [overdue, setOverdue] = useState(searchParams.get('overdue') === 'true');
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<PurchaseOrder[]>([]);
  const [meta, setMeta] = useState<PurchaseOrderListMeta | null>(null);
  const [loading, setLoading] = useState(false);

  const debouncedSearch = useDebouncedValue(search, 250);
  const fetchSeq = useRef(0);

  const refreshSummary = useSupplierStore((s: any) => s.refreshSummary);

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
    updateParams({
      status: status || null,
      paymentStatus: paymentStatus || null,
      overdue: overdue ? 'true' : null,
      search: search || null,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, paymentStatus, overdue, search]);

  const totals = meta?.totals;

  const columns = useMemo<TableColumn[]>(
    () => [
      {
        key: 'poNumber',
        header: 'PO #',
        render: (r: PurchaseOrder) => (
          <div
            className={`pl-2 -ml-2 ${
              isOverdueRow(r) ? 'border-l-2 border-error' : ''
            }`}
          >
            <button
              type="button"
              onClick={() => router.push(`/purchase-orders/${r.id}`)}
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
        render: (r: PurchaseOrder) => (
          <button
            type="button"
            onClick={(e: React.MouseEvent) => {
              e.stopPropagation();
              router.push(`/suppliers/${r.supplierId}`);
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
        render: (r: PurchaseOrder) => formatDate(r.orderDate),
      },
      { key: 'itemsCount', header: 'Items', align: 'right' },
      ...(canSeeCost
        ? [
            {
              key: 'totalCost',
              header: 'Total',
              align: 'right' as const,
              render: (r: PurchaseOrder) => formatCurrency(r.totalCost),
            },
            {
              key: 'amountPaid',
              header: 'Paid',
              align: 'right' as const,
              render: (r: PurchaseOrder) => formatCurrency(r.amountPaid),
            },
            {
              key: 'balanceDue',
              header: 'Balance',
              align: 'right' as const,
              render: (r: PurchaseOrder) => (
                <span className={(r.balanceDue || 0) > 0 ? 'text-accent font-medium' : ''}>
                  {formatCurrency(r.balanceDue)}
                </span>
              ),
            },
          ]
        : []),
      {
        key: 'dueDate',
        header: 'Due',
        render: (r: PurchaseOrder) =>
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
        render: (r: PurchaseOrder) => (
          <div className="flex items-center gap-1.5">
            <POStatusBadge status={r.status} size="sm" />
            <PaymentStatusBadge status={r.paymentStatus} size="sm" />
          </div>
        ),
      },
    ],
    [canSeeCost, router],
  );

  return (
    <div className="space-y-5">
      <PageHeader
        title="Purchase orders"
        subtitle="Issue, receive, and reconcile every PO with full audit history."
        action={
          <PermissionGate permission="supplier.purchase_order.create">
            <Button
              leftIcon={<Plus className="h-4 w-4" />}
              onClick={() => router.push('/purchase-orders/new')}
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
          value={totals?.pendingPayment ?? 0}
        />
        <SummaryCard
          icon={<AlertCircle className="h-5 w-5" />}
          label="Overdue"
          value={
            totals?.overdueAmount != null
              ? formatCurrency(totals.overdueAmount)
              : totals?.overdueCount ?? 0
          }
          tone={(totals?.overdueCount || 0) > 0 ? 'error' : 'default'}
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
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
              setPage(1);
              setSearch(e.target.value);
            }}
          />
        </div>
        <div className="md:col-span-1">
          <SupplierSelect
            label={null}
            value={supplier}
            onChange={(s: Supplier | null) => {
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
            onChange={(v: string) => {
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
            onChange={(v: string) => {
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
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
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
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
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
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
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
        rowKey={(r: PurchaseOrder) => r.id}
        loading={loading}
        onRowClick={(r: PurchaseOrder) => router.push(`/purchase-orders/${r.id}`)}
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
      <div className={`h-9 w-9 rounded-md flex items-center justify-center ${TONES[tone]}`}>
        {icon}
      </div>
    </div>
  );
}

export default function PurchaseOrdersPage() {
  return (
    <RequirePermission permission="supplier.view">
      <PurchaseOrdersPageContent />
    </RequirePermission>
  );
}
