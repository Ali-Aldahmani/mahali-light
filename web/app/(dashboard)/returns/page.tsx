'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Search, RotateCcw, ClipboardList, ShieldCheck } from 'lucide-react';
import PageHeader from '@/components/ui/PageHeader';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import Select from '@/components/ui/Select';
import Tabs from '@/components/ui/Tabs';
import Table from '@/components/ui/Table';
import EmptyState from '@/components/ui/EmptyState';
import PermissionGate from '@/components/ui/PermissionGate';
import ReturnTypeBadge from '@/components/ui/ReturnTypeBadge';
import ReturnStatusBadge from '@/components/ui/ReturnStatusBadge';
import ReturnRequestCard from '@/components/returns/ReturnRequestCard';
import RequirePermission from '@/components/guards/RequirePermission';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { useReturnStore } from '@/store/returnStore';
import { useAuthStore } from '@/store/authStore';
import { toast } from '@/store/toastStore';
import {
  listReturnRequests,
  approveReturnRequest,
  rejectReturnRequest,
} from '@/services/returnService';
import { listReturnOrders } from '@/services/returnOrderService';
import { onReturnEvent } from '@/store/socketStore';
import { formatCurrency, formatDate, timeAgo } from '@/lib/utils/format';
import type { ReturnRequest, ReturnOrder, SelectOption } from './types';

const TYPE_OPTIONS: SelectOption[] = [
  { value: '', label: 'All types' },
  { value: 'customer_refund', label: 'Customer refund' },
  { value: 'customer_replace', label: 'Customer replace' },
  { value: 'supplier_return', label: 'Supplier return' },
];

const STATUS_OPTIONS: SelectOption[] = [
  { value: '', label: 'All statuses' },
  { value: 'pending', label: 'Pending' },
  { value: 'approved', label: 'Approved' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'cancelled', label: 'Cancelled' },
];

function ReturnsPageContent() {
  const router = useRouter();
  const user = useAuthStore((s: any) => s.user);
  const permissions: string[] = user?.permissions || [];
  const canApprove = permissions.includes('return.approve') || permissions.includes('*');
  const store = useReturnStore();
  const refreshStore = useReturnStore((s: any) => s.refresh);

  const [tab, setTab] = useState('requests');

  useEffect(() => {
    refreshStore();
  }, [refreshStore]);

  useEffect(() => onReturnEvent(() => refreshStore()), [refreshStore]);

  return (
    <div className="p-8">
      <PageHeader
        title="Returns"
        subtitle="Manage refund, replacement and supplier return requests."
        action={
          <PermissionGate permission="return.request">
            <Button
              leftIcon={<Plus className="h-4 w-4" />}
              onClick={() => router.push('/returns/new')}
            >
              New return request
            </Button>
          </PermissionGate>
        }
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <SummaryCard label="Pending requests" value={store.pendingCount} tone="warning" />
        <SummaryCard
          label="No-invoice pending"
          value={store.pendingNoInvoiceCount}
          tone="error"
        />
        <SummaryCard
          label="Approved this month"
          value={store.approvedThisMonth}
          tone="success"
        />
        <SummaryCard
          label="Refunded value"
          value={formatCurrency(store.ordersTotalRefunded || 0)}
          tone="accent"
          isCurrency
        />
      </div>

      <Tabs
        items={[
          { value: 'requests', label: 'Requests', icon: <ClipboardList className="h-4 w-4" /> },
          { value: 'orders', label: 'Return orders', icon: <RotateCcw className="h-4 w-4" /> },
          ...(canApprove
            ? [
                {
                  value: 'pending',
                  label: 'Pending approval',
                  icon: <ShieldCheck className="h-4 w-4" />,
                  count: store.pendingCount || undefined,
                },
              ]
            : []),
        ]}
        value={tab}
        onChange={setTab}
        className="mb-4"
      />

      {tab === 'requests' && <RequestsTab />}
      {tab === 'orders' && <OrdersTab />}
      {tab === 'pending' && canApprove && <PendingApprovalTab />}
    </div>
  );
}

function RequestsTab() {
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [type, setType] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<ReturnRequest[]>([]);
  const [meta, setMeta] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const debouncedSearch = useDebouncedValue(search, 300);
  const seqRef = useRef(0);

  async function load() {
    const seq = ++seqRef.current;
    setLoading(true);
    try {
      const res = await listReturnRequests({
        page,
        limit: 20,
        return_type: type,
        status,
        search: debouncedSearch,
      });
      if (seq !== seqRef.current) return;
      setRows(res.data || []);
      setMeta(res.meta || null);
    } finally {
      if (seq === seqRef.current) setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type, status, debouncedSearch, page]);

  useEffect(
    () => onReturnEvent(() => load()),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [type, status, debouncedSearch, page],
  );

  const columns = [
    {
      key: 'requestNumber',
      header: 'Request',
      render: (row: ReturnRequest) => <span className="font-mono text-xs">{row.requestNumber}</span>,
    },
    {
      key: 'type',
      header: 'Type',
      render: (row: ReturnRequest) => <ReturnTypeBadge type={row.returnType} size="sm" />,
    },
    {
      key: 'party',
      header: 'Customer / Supplier',
      render: (row: ReturnRequest) => (
        <div>
          <div className="text-sm">{row.customerName || row.supplierName || '—'}</div>
          {row.customerPhone && (
            <div className="text-xs text-ink-muted">{row.customerPhone}</div>
          )}
        </div>
      ),
    },
    {
      key: 'items',
      header: 'Items',
      render: (row: ReturnRequest) => `${row.itemCount || 0}`,
    },
    {
      key: 'value',
      header: 'Value',
      render: (row: ReturnRequest) => formatCurrency(row.totalValue || 0),
    },
    {
      key: 'invoice',
      header: 'Invoice',
      render: (row: ReturnRequest) =>
        row.invoiceNumber ? (
          <span className="font-mono text-xs">{row.invoiceNumber}</span>
        ) : row.noInvoiceReturn ? (
          <span className="text-xs text-warning">No invoice</span>
        ) : (
          '—'
        ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (row: ReturnRequest) => <ReturnStatusBadge status={row.status} size="sm" />,
    },
    {
      key: 'when',
      header: 'Submitted',
      render: (row: ReturnRequest) => (
        <div className="text-xs">
          <div>{formatDate(row.requestedAt)}</div>
          <div className="text-ink-muted">{timeAgo(row.requestedAt)}</div>
        </div>
      ),
    },
  ];

  return (
    <div>
      <div className="card p-4 mb-4 grid grid-cols-1 sm:grid-cols-4 gap-3">
        <Input
          leftIcon={<Search className="h-4 w-4" />}
          placeholder="Search request, invoice, customer"
          value={search}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSearch(e.target.value)}
          containerClassName="sm:col-span-2"
        />
        <Select value={type} onChange={(v: string) => setType(v)} options={TYPE_OPTIONS} />
        <Select
          value={status}
          onChange={(v: string) => setStatus(v)}
          options={STATUS_OPTIONS}
        />
      </div>

      <Table
        columns={columns}
        rows={rows}
        loading={loading}
        empty={
          <EmptyState
            icon={ClipboardList}
            title="No return requests yet"
            description="Submit a new return request from the POS or this page."
          />
        }
        onRowClick={(row: ReturnRequest) => router.push(`/returns/requests/${row.id}`)}
        pagination={
          meta
            ? {
                page: meta.page,
                pageSize: meta.limit,
                total: meta.total,
                onPageChange: setPage,
              }
            : null
        }
      />
    </div>
  );
}

function OrdersTab() {
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [type, setType] = useState('');
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<ReturnOrder[]>([]);
  const [meta, setMeta] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const debouncedSearch = useDebouncedValue(search, 300);
  const seqRef = useRef(0);

  async function load() {
    const seq = ++seqRef.current;
    setLoading(true);
    try {
      const res = await listReturnOrders({
        page,
        limit: 20,
        return_type: type,
        search: debouncedSearch,
      });
      if (seq !== seqRef.current) return;
      setRows(res.data || []);
      setMeta(res.meta || null);
    } finally {
      if (seq === seqRef.current) setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type, debouncedSearch, page]);

  useEffect(
    () => onReturnEvent(() => load()),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [type, debouncedSearch, page],
  );

  const columns = [
    {
      key: 'orderNumber',
      header: 'Order',
      render: (row: ReturnOrder) => <span className="font-mono text-xs">{row.returnOrderNumber}</span>,
    },
    {
      key: 'type',
      header: 'Type',
      render: (row: ReturnOrder) => <ReturnTypeBadge type={row.returnType} size="sm" />,
    },
    {
      key: 'party',
      header: 'Customer / Supplier',
      render: (row: ReturnOrder) => row.customerName || row.supplierName || '—',
    },
    {
      key: 'invoice',
      header: 'Original invoice',
      render: (row: ReturnOrder) =>
        row.originalInvoiceNumber ? (
          <span className="font-mono text-xs">{row.originalInvoiceNumber}</span>
        ) : (
          '—'
        ),
    },
    {
      key: 'value',
      header: 'Total value',
      render: (row: ReturnOrder) => formatCurrency(row.totalValue || 0),
    },
    {
      key: 'refund',
      header: 'Refunded',
      render: (row: ReturnOrder) => formatCurrency(row.refundTotal || 0),
    },
    {
      key: 'processed',
      header: 'Processed',
      render: (row: ReturnOrder) => (
        <div className="text-xs">
          <div>{formatDate(row.createdAt)}</div>
          <div className="text-ink-muted">{row.employeeUsername || '—'}</div>
        </div>
      ),
    },
  ];

  return (
    <div>
      <div className="card p-4 mb-4 grid grid-cols-1 sm:grid-cols-4 gap-3">
        <Input
          leftIcon={<Search className="h-4 w-4" />}
          placeholder="Search order, invoice, customer"
          value={search}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSearch(e.target.value)}
          containerClassName="sm:col-span-2"
        />
        <Select value={type} onChange={(v: string) => setType(v)} options={TYPE_OPTIONS} />
      </div>

      <Table
        columns={columns}
        rows={rows}
        loading={loading}
        empty={
          <EmptyState
            icon={RotateCcw}
            title="No return orders yet"
            description="Approved return requests will create return orders here."
          />
        }
        onRowClick={(row: ReturnOrder) => router.push(`/returns/orders/${row.id}`)}
        pagination={
          meta
            ? {
                page: meta.page,
                pageSize: meta.limit,
                total: meta.total,
                onPageChange: setPage,
              }
            : null
        }
      />
    </div>
  );
}

function PendingApprovalTab() {
  const router = useRouter();
  const [rows, setRows] = useState<ReturnRequest[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const refreshStore = useReturnStore((s: any) => s.refresh);

  async function load() {
    setLoading(true);
    try {
      const res = await listReturnRequests({ status: 'pending', limit: 100 });
      // Sort: no-invoice first, then oldest first (FIFO).
      const list = [...(res.data || [])].sort((a: ReturnRequest, b: ReturnRequest) => {
        if (a.noInvoiceReturn && !b.noInvoiceReturn) return -1;
        if (!a.noInvoiceReturn && b.noInvoiceReturn) return 1;
        return new Date(a.requestedAt || 0).getTime() - new Date(b.requestedAt || 0).getTime();
      });
      setRows(list);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  useEffect(() => onReturnEvent(() => load()), []);

  async function handleApprove(req: ReturnRequest) {
    if (
      !window.confirm(
        `Approve return ${req.requestNumber}? This will move stock, issue refunds, and update warranties.`,
      )
    ) {
      return;
    }
    setBusyId(req.id);
    try {
      await approveReturnRequest(req.id);
      toast.success(`Return ${req.requestNumber} approved.`);
      await load();
      refreshStore();
    } catch (err: any) {
      toast.error(err?.message || 'Failed to approve return.');
    } finally {
      setBusyId(null);
    }
  }

  async function handleReject(req: ReturnRequest) {
    const reason = window.prompt(
      `Reject return ${req.requestNumber}?\n\nProvide a reason (visible to the requester):`,
    );
    if (!reason || !reason.trim()) return;
    setBusyId(req.id);
    try {
      await rejectReturnRequest(req.id, reason.trim());
      toast.success(`Return ${req.requestNumber} rejected.`);
      await load();
      refreshStore();
    } catch (err: any) {
      toast.error(err?.message || 'Failed to reject return.');
    } finally {
      setBusyId(null);
    }
  }

  if (loading && rows.length === 0) {
    return (
      <div className="card p-12 text-center text-sm text-ink-muted">
        Loading pending return requests…
      </div>
    );
  }

  if (!rows.length) {
    return (
      <EmptyState
        icon={ShieldCheck}
        title="Nothing waiting for review"
        description="All clear. New return requests will appear here."
      />
    );
  }

  return (
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
      {rows.map((req) => (
        <div
          key={req.id}
          role="button"
          tabIndex={0}
          onClick={(e: React.MouseEvent<HTMLDivElement>) => {
            // Don't navigate if a button inside the card was clicked.
            if ((e.target as HTMLElement).closest('button')) return;
            router.push(`/returns/requests/${req.id}`);
          }}
          onKeyDown={(e: React.KeyboardEvent<HTMLDivElement>) => {
            if (e.key === 'Enter') router.push(`/returns/requests/${req.id}`);
          }}
          className="cursor-pointer focus:outline-none"
        >
          <ReturnRequestCard
            request={req}
            onApprove={handleApprove}
            onReject={handleReject}
            isBusy={busyId === req.id}
          />
        </div>
      ))}
    </div>
  );
}

function SummaryCard({
  label,
  value,
  tone = 'neutral',
  isCurrency = false,
}: {
  label: string;
  value: number | string | undefined;
  tone?: 'success' | 'warning' | 'accent' | 'error' | 'neutral';
  isCurrency?: boolean;
}) {
  const toneClass =
    tone === 'success'
      ? 'text-success'
      : tone === 'warning'
        ? 'text-warning'
        : tone === 'accent'
          ? 'text-accent'
          : tone === 'error'
            ? 'text-error'
            : 'text-ink';
  return (
    <div className="card p-4">
      <div className="text-xs uppercase tracking-wider text-ink-muted">{label}</div>
      <div className={`mt-1 ${isCurrency ? 'text-xl' : 'text-2xl'} font-semibold ${toneClass}`}>
        {value || (isCurrency ? formatCurrency(0) : 0)}
      </div>
    </div>
  );
}

export default function ReturnsPage() {
  return (
    <RequirePermission permission="return.request">
      <ReturnsPageContent />
    </RequirePermission>
  );
}
