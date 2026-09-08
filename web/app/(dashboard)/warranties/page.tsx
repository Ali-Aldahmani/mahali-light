'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Search, ShieldCheck } from 'lucide-react';
import PageHeader from '@/components/ui/PageHeader';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import Select from '@/components/ui/Select';
import Table from '@/components/ui/Table';
import EmptyState from '@/components/ui/EmptyState';
import WarrantyStatusBadge from '@/components/ui/WarrantyStatusBadge';
import DaysRemainingBadge from '@/components/ui/DaysRemainingBadge';
import PermissionGate from '@/components/ui/PermissionGate';
import RequirePermission from '@/components/guards/RequirePermission';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { useWarrantyStore } from '@/store/warrantyStore';
import { listWarranties } from '@/services/warrantyService';
import { formatDate } from '@/lib/utils/format';
import { onWarrantyEvent } from '@/store/socketStore';
import WarrantyFormSlideOver from '@/components/warranties/WarrantyFormSlideOver';
import type { SelectOption, Warranty } from '@/components/warranties/types';

const TABS: SelectOption[] = [
  { value: '', label: 'All' },
  { value: 'active', label: 'Active' },
  { value: 'expiring_soon', label: 'Expiring soon' },
  { value: 'expired', label: 'Expired' },
  { value: 'claimed', label: 'Claimed' },
  { value: 'void', label: 'Void' },
];

const TYPE_OPTIONS: SelectOption[] = [
  { value: '', label: 'All types' },
  { value: 'customer', label: 'Customer' },
  { value: 'supplier', label: 'Supplier' },
];

const SORT_OPTIONS: SelectOption[] = [
  { value: 'end_date_asc', label: 'Expiring soonest' },
  { value: 'end_date_desc', label: 'Expiring latest' },
  { value: 'created_desc', label: 'Recently added' },
  { value: 'product', label: 'Product (A-Z)' },
  { value: 'customer', label: 'Customer (A-Z)' },
];

function WarrantiesPageContent() {
  const router = useRouter();
  const refreshSummary = useWarrantyStore((s: any) => s.refresh);
  const store = useWarrantyStore();

  const [tab, setTab] = useState('');
  const [search, setSearch] = useState('');
  const [type, setType] = useState('');
  const [sort, setSort] = useState('end_date_asc');
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<Warranty[]>([]);
  const [meta, setMeta] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const debouncedSearch = useDebouncedValue(search, 300);
  const seqRef = useRef(0);

  useEffect(() => {
    refreshSummary();
  }, [refreshSummary]);

  async function load() {
    const seq = ++seqRef.current;
    setLoading(true);
    try {
      const filters: Record<string, any> = {
        page,
        limit: 25,
        warranty_type: type,
        search: debouncedSearch,
        sort,
      };
      if (tab === 'expiring_soon') filters.expiring_soon = 'true';
      else if (tab === 'expired') filters.expired = 'true';
      else if (tab) filters.status = tab;
      const res = await listWarranties(filters);
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
  }, [tab, debouncedSearch, type, sort, page]);

  useEffect(
    () =>
      onWarrantyEvent(() => {
        load();
        refreshSummary();
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tab, debouncedSearch, type, sort, page],
  );

  const columns = [
    {
      key: 'warrantyNumber',
      header: 'Warranty',
      render: (row: Warranty) => (
        <span className="font-mono text-xs">{row.warrantyNumber}</span>
      ),
    },
    {
      key: 'product',
      header: 'Product',
      render: (row: Warranty) => (
        <div className="min-w-0">
          <div className="text-sm font-medium truncate">{row.productName || '—'}</div>
          {row.serialNumber && (
            <div className="text-xs text-ink-muted font-mono truncate">
              SN: {row.serialNumber}
            </div>
          )}
        </div>
      ),
    },
    {
      key: 'customer',
      header: 'Customer',
      render: (row: Warranty) => (
        <div>
          <div className="text-sm">{row.customerName || 'Guest'}</div>
          {row.customerPhone && (
            <div className="text-xs text-ink-muted">{row.customerPhone}</div>
          )}
        </div>
      ),
    },
    {
      key: 'start_date',
      header: 'Start',
      render: (row: Warranty) => formatDate(row.startDate),
    },
    {
      key: 'end_date',
      header: 'End',
      render: (row: Warranty) => formatDate(row.endDate),
    },
    {
      key: 'duration',
      header: 'Duration',
      render: (row: Warranty) => `${row.durationMonths} mo`,
    },
    {
      key: 'status',
      header: 'Status',
      render: (row: Warranty) => (
        <WarrantyStatusBadge status={row.status} expiringSoon={row.expiringSoon} size="sm" />
      ),
    },
    {
      key: 'days',
      header: 'Days',
      render: (row: Warranty) => (
        <DaysRemainingBadge daysRemaining={row.daysRemaining} size="sm" />
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Warranties"
        subtitle="Customer + supplier warranties created from invoices and manual records."
        action={
          <PermissionGate permission="warranty.create">
            <Button leftIcon={<Plus className="h-4 w-4" />} onClick={() => setFormOpen(true)}>
              Add warranty
            </Button>
          </PermissionGate>
        }
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <SummaryCard label="Active" value={store.activeCount} tone="success" />
        <SummaryCard
          label="Expiring this month"
          value={store.expiringThisMonthCount}
          tone="warning"
        />
        <SummaryCard label="Open claims" value={store.openClaimsCount} tone="accent" />
        <SummaryCard
          label="Expired this year"
          value={store.expiredThisYearCount}
          tone="error"
        />
      </div>

      <div className="card p-4 mb-6 space-y-4">
        <div className="flex items-center gap-2 flex-wrap">
          {TABS.map((t) => (
            <button
              key={t.value || 'all'}
              onClick={() => {
                setTab(t.value);
                setPage(1);
              }}
              className={`h-8 rounded-input px-3 text-xs font-medium border transition ${
                tab === t.value
                  ? 'border-accent bg-accent-light text-accent'
                  : 'border-border bg-surface text-ink-muted hover:text-ink'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
          <Input
            leftIcon={<Search className="h-4 w-4" />}
            placeholder="Search serial, customer, invoice, product"
            value={search}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSearch(e.target.value)}
            containerClassName="sm:col-span-2"
          />
          <Select value={type} onChange={(v: string) => setType(v)} options={TYPE_OPTIONS} />
          <Select value={sort} onChange={(v: string) => setSort(v)} options={SORT_OPTIONS} />
        </div>
      </div>

      <Table
        columns={columns}
        rows={rows}
        loading={loading}
        empty={
          <EmptyState
            icon={ShieldCheck}
            title="No warranties yet"
            description="Warranties are created automatically when an invoice is confirmed."
          />
        }
        onRowClick={(row: Warranty) => router.push(`/warranties/${row.id}`)}
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

      <WarrantyFormSlideOver
        open={formOpen}
        onClose={(refresh) => {
          setFormOpen(false);
          if (refresh) {
            load();
            refreshSummary();
          }
        }}
      />
    </div>
  );
}

function SummaryCard({
  label,
  value,
  tone = 'neutral',
}: {
  label: string;
  value: number;
  tone?: 'success' | 'warning' | 'accent' | 'error' | 'neutral';
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
      <div className={`mt-1 text-2xl font-semibold ${toneClass}`}>{value || 0}</div>
    </div>
  );
}

export default function WarrantiesPage() {
  return (
    <RequirePermission permission="warranty.view">
      <WarrantiesPageContent />
    </RequirePermission>
  );
}
