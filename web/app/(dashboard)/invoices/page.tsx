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
  ShoppingCart,
  Download,
  FileText,
  FileSpreadsheet,
  Sheet,
  Loader2,
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
import {
  exportInvoices,
  listInvoices,
  type InvoiceExportFormat,
} from '@/services/invoiceService';
import DropdownMenu from '@/components/ui/dropdown-menu';
import { toast } from '@/store/toastStore';
import { formatCurrency, formatDateTime } from '@/lib/utils/format';
import RowActions from '@/components/ui/RowActions';
import { useInvoiceActions } from '@/components/invoices/useInvoiceActions';
import AvatarGroup from '@/components/ui/avatar-group/AvatarGroup';
import DateRangeField from '@/components/ui/DateRangeField';
import CustomerHoverName from '@/components/customers/CustomerHoverName';
import TriStateCheckbox from '@/components/ui/TriStateCheckbox';

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

  // Row actions (preview, print, PDF, request edit, cancel) and their dialogs.
  const invoiceActions = useInvoiceActions({
    onChanged: () => {
      fetchData();
      refreshSummary?.();
    },
  });

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

  // Selection. `selectedIds` holds invoices ticked one by one (kept across
  // pages); `allMatching` means every invoice matching the current filters,
  // including the ones on pages that are not loaded.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [allMatching, setAllMatching] = useState(false);

  function clearSelection() {
    setSelectedIds(new Set());
    setAllMatching(false);
  }

  // A selection made under one set of filters does not carry to another.
  useEffect(() => {
    clearSelection();
  }, [debouncedSearch, status, paymentStatus, dateFrom, dateTo]);

  const total = meta?.total || 0;
  const pageSelectedCount = allMatching
    ? rows.length
    : rows.filter((r) => selectedIds.has(r.id)).length;
  const pageState: 'all' | 'some' | 'none' =
    rows.length > 0 && pageSelectedCount === rows.length
      ? 'all'
      : pageSelectedCount > 0
        ? 'some'
        : 'none';
  const selectedCount = allMatching ? total : selectedIds.size;

  function toggleRow(id: string) {
    // Unticking one invoice out of "all matching" leaves the rest of this
    // page selected; the unloaded pages can no longer be counted on.
    const base = allMatching ? new Set<string>(rows.map((r) => r.id)) : new Set(selectedIds);
    if (base.has(id)) base.delete(id);
    else base.add(id);
    setAllMatching(false);
    setSelectedIds(base);
  }

  function togglePage() {
    if (allMatching) {
      clearSelection();
      return;
    }
    const next = new Set(selectedIds);
    if (pageState === 'all') rows.forEach((r) => next.delete(r.id));
    else rows.forEach((r) => next.add(r.id));
    setSelectedIds(next);
  }

  const canDownload = permissions.includes('invoice.download');
  const [downloading, setDownloading] = useState(false);

  async function download(format: InvoiceExportFormat) {
    setDownloading(true);
    try {
      const res = await exportInvoices(
        format,
        allMatching
          ? { filters: { search: debouncedSearch, status, paymentStatus, dateFrom, dateTo } }
          : { ids: [...selectedIds] },
      );
      toast.success(`Downloaded ${res.filename}.`);
    } catch (err: any) {
      toast.error(err?.message || 'Download failed.');
    } finally {
      setDownloading(false);
    }
  }

  const columns = useMemo<TableColumn[]>(
    () => [
      {
        key: 'select',
        header: (
          <TriStateCheckbox
            checked={pageState === 'all'}
            indeterminate={pageState === 'some'}
            onChange={togglePage}
            aria-label="Select all invoices on this page"
          />
        ),
        sortable: false,
        width: 38,
        render: (r: any) => (
          <TriStateCheckbox
            checked={allMatching || selectedIds.has(r.id)}
            onChange={() => toggleRow(r.id)}
            aria-label={`Select ${r.invoiceNumber}`}
          />
        ),
      },
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
              <CustomerHoverName id={r.customerId} name={r.customerName} />
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
        render: (r: any) =>
          r.createdByUsername ? (
            <span className="inline-flex items-center gap-1.5">
              <AvatarGroup size="sm" label="Created by" members={[{ name: r.createdByUsername }]} />
              {r.pcIdentifier && (
                <span className="text-[11px] text-ink-muted" title="Till / PC">
                  {r.pcIdentifier}
                </span>
              )}
            </span>
          ) : (
            <span className="text-xs text-ink-muted">—</span>
          ),
      },
      {
        key: 'actions',
        header: '',
        align: 'right' as const,
        sortable: false,
        render: (r: any) => (
          <RowActions
            label={`Actions for ${r.invoiceNumber}`}
            primary="open"
            actions={invoiceActions.actionsFor(r, { withOpen: true, onOpen: () => router.push(`/invoices/${r.id}`) })}
          />
        ),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [router, permissions, rows, selectedIds, allMatching],
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
        <DateRangeField
          label="Invoice date"
          from={dateFrom}
          to={dateTo}
          onChange={({ from, to }) => {
            setPage(1);
            setDateFrom(from);
            setDateTo(to);
          }}
        />
      </div>

      {selectedCount > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-accent/30 bg-accent-light px-4 py-2.5">
          {canDownload && (
            <div className="order-last ml-auto">
              <DropdownMenu
                label={downloading ? 'Downloading…' : 'Download'}
                icon={downloading ? <Loader2 className="animate-spin" /> : <Download />}
                disabled={downloading}
                items={[
                  { label: 'PDF', icon: <FileText />, onSelect: () => void download('pdf') },
                  { label: 'Excel', icon: <FileSpreadsheet />, onSelect: () => void download('excel') },
                  { label: 'CSV', icon: <Sheet />, onSelect: () => void download('csv') },
                ]}
              />
            </div>
          )}
          <span className="text-sm text-accent font-medium">
            {allMatching
              ? `All ${total} invoices selected`
              : `${selectedCount} invoice${selectedCount === 1 ? '' : 's'} selected`}
          </span>
          {!allMatching && total > selectedIds.size && (
            <button
              type="button"
              onClick={() => setAllMatching(true)}
              className="text-xs text-accent hover:text-ink underline"
            >
              Select all {total} invoices
            </button>
          )}
          <button
            type="button"
            onClick={clearSelection}
            className="text-xs text-ink-muted hover:text-ink underline"
          >
            Clear selection
          </button>
        </div>
      )}

      <Table
        columns={columns}
        rows={rows}
        rowKey={(r: any) => r.id}
        loading={loading}
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

      {invoiceActions.dialogs}
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
