'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Plus,
  Search,
  Building2,
  Wallet,
  AlertCircle,
  Edit3,
  Power,
  Eye,
} from 'lucide-react';
import PageHeader from '@/components/ui/PageHeader';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import Select from '@/components/ui/Select';
import Table, { type TableColumn } from '@/components/ui/Table';
import Badge from '@/components/ui/Badge';
import EmptyState from '@/components/ui/EmptyState';
import PermissionGate from '@/components/ui/PermissionGate';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import RequirePermission from '@/components/guards/RequirePermission';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { useAuthStore } from '@/store/authStore';
import { useSupplierStore } from '@/store/supplierStore';
import { toast } from '@/store/toastStore';
import { listSuppliers, deactivateSupplier } from '@/services/supplierService';
import { formatCurrency, formatDate } from '@/lib/utils/format';
import { onPurchaseOrderEvent } from '@/store/socketStore';
import SupplierFormSlideOver from '@/components/suppliers/SupplierFormSlideOver';
import type { Supplier, SupplierListMeta } from '@/components/suppliers/types';

const ACTIVE_OPTIONS = [
  { value: '', label: 'All suppliers' },
  { value: 'true', label: 'Active only' },
  { value: 'false', label: 'Inactive only' },
];

function SuppliersPageContent() {
  const router = useRouter();
  const permissions = useAuthStore((s: any) => s.permissions);
  const canEdit = permissions.includes('supplier.edit');
  const canDelete = permissions.includes('supplier.delete');

  const [search, setSearch] = useState('');
  const [isActive, setIsActive] = useState('true');
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<Supplier[]>([]);
  const [meta, setMeta] = useState<SupplierListMeta | null>(null);
  const [loading, setLoading] = useState(false);

  const [formOpen, setFormOpen] = useState(false);
  const [editingSupplier, setEditingSupplier] = useState<Supplier | null>(null);
  const [confirm, setConfirm] = useState<Supplier | null>(null);

  const debouncedSearch = useDebouncedValue(search, 250);
  const fetchSeq = useRef(0);

  const refreshSummary = useSupplierStore((s: any) => s.refreshSummary);

  // Fetch list -----------------------------------------------------
  const fetchData = async () => {
    const seq = ++fetchSeq.current;
    setLoading(true);
    try {
      const res = await listSuppliers({
        page,
        limit: 25,
        search: debouncedSearch || undefined,
        isActive: isActive || undefined,
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
  }, [page, debouncedSearch, isActive]);

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

  // Build summary cards from meta totals.
  const summary = meta?.totals;

  const columns = useMemo<TableColumn[]>(
    () => [
      {
        key: 'name',
        header: 'Supplier',
        render: (r: Supplier) => (
          <div className="min-w-0">
            <button
              type="button"
              onClick={() => router.push(`/suppliers/${r.id}`)}
              className="text-sm font-medium text-ink hover:text-accent text-left truncate block max-w-[260px]"
              title={r.name}
            >
              {r.name}
            </button>
            <div className="text-xs text-ink-muted truncate">
              {r.contactPerson || '—'}
            </div>
          </div>
        ),
      },
      {
        key: 'phone',
        header: 'Phone',
        render: (r: Supplier) => r.phone || '—',
      },
      {
        key: 'totalSpent',
        header: 'Total spent',
        align: 'right' as const,
        render: (r: Supplier) => formatCurrency(r.totalSpent || 0),
      },
      {
        key: 'outstandingBalance',
        header: 'Outstanding',
        align: 'right' as const,
        render: (r: Supplier) => {
          const v = Number(r.outstandingBalance || 0);
          return (
            <span className={v > 0 ? 'text-accent font-medium' : ''}>
              {formatCurrency(v)}
            </span>
          );
        },
      },
      {
        key: 'lastOrderDate',
        header: 'Last order',
        render: (r: Supplier) => (r.lastOrderDate ? formatDate(r.lastOrderDate) : '—'),
      },
      {
        key: 'status',
        header: 'Status',
        render: (r: Supplier) => (
          <div className="flex items-center gap-1.5">
            <Badge tone={r.isActive ? 'success' : 'muted'} size="sm" dot>
              {r.isActive ? 'Active' : 'Inactive'}
            </Badge>
            {(r.overdueCount || 0) > 0 && (
              <Badge tone="error" size="sm">
                {r.overdueCount} overdue
              </Badge>
            )}
          </div>
        ),
      },
      {
        key: 'actions',
        header: '',
        sortable: false,
        align: 'right' as const,
        render: (r: Supplier) => (
          <div className="inline-flex items-center justify-end gap-1">
            <Button
              size="sm"
              variant="ghost"
              leftIcon={<Eye className="h-4 w-4" />}
              onClick={(e: React.MouseEvent) => {
                e.stopPropagation();
                router.push(`/suppliers/${r.id}`);
              }}
            >
              View
            </Button>
            {canEdit && (
              <Button
                size="sm"
                variant="ghost"
                leftIcon={<Edit3 className="h-4 w-4" />}
                onClick={(e: React.MouseEvent) => {
                  e.stopPropagation();
                  setEditingSupplier(r);
                  setFormOpen(true);
                }}
              >
                Edit
              </Button>
            )}
            {canDelete && r.isActive && (
              <Button
                size="sm"
                variant="ghost"
                leftIcon={<Power className="h-4 w-4" />}
                onClick={(e: React.MouseEvent) => {
                  e.stopPropagation();
                  setConfirm(r);
                }}
              >
                Deactivate
              </Button>
            )}
          </div>
        ),
      },
    ],
    [canEdit, canDelete, router],
  );

  async function handleDeactivate() {
    if (!confirm) return;
    try {
      await deactivateSupplier(confirm.id);
      toast.success(`${confirm.name} deactivated.`);
      setConfirm(null);
      fetchData();
    } catch (err: any) {
      toast.error(err?.message || 'Failed to deactivate supplier.');
      setConfirm(null);
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Suppliers"
        subtitle="Manage vendors, payment terms, and live performance metrics."
        action={
          <PermissionGate permission="supplier.create">
            <Button
              leftIcon={<Plus className="h-4 w-4" />}
              onClick={() => {
                setEditingSupplier(null);
                setFormOpen(true);
              }}
            >
              Add supplier
            </Button>
          </PermissionGate>
        }
      />

      <div className="grid grid-cols-3 gap-4">
        <SummaryCard
          icon={<Building2 className="h-5 w-5" />}
          label="Active suppliers"
          value={summary?.totalSuppliers ?? '—'}
        />
        <SummaryCard
          icon={<Wallet className="h-5 w-5" />}
          label="Outstanding to suppliers"
          value={
            summary?.totalOutstanding != null
              ? formatCurrency(summary.totalOutstanding)
              : '—'
          }
          tone={(summary?.totalOutstanding || 0) > 0 ? 'warning' : 'default'}
        />
        <SummaryCard
          icon={<AlertCircle className="h-5 w-5" />}
          label="Overdue payments"
          value={summary?.overdueCount ?? 0}
          tone={(summary?.overdueCount || 0) > 0 ? 'error' : 'default'}
        />
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-[260px]">
          <Input
            placeholder="Search by name, contact, phone, or email…"
            leftIcon={<Search className="h-4 w-4" />}
            value={search}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
              setPage(1);
              setSearch(e.target.value);
            }}
          />
        </div>
        <div className="w-48">
          <Select
            value={isActive}
            onChange={(v: string) => {
              setPage(1);
              setIsActive(v);
            }}
            options={ACTIVE_OPTIONS}
            searchable={false}
          />
        </div>
      </div>

      <Table
        columns={columns}
        rows={rows}
        rowKey={(r: Supplier) => r.id}
        loading={loading}
        onRowClick={(r: Supplier) => router.push(`/suppliers/${r.id}`)}
        empty={
          <EmptyState
            title="No suppliers"
            description="Add your first supplier to start creating purchase orders."
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

      <SupplierFormSlideOver
        open={formOpen}
        onClose={() => setFormOpen(false)}
        supplier={editingSupplier}
        onSaved={() => {
          fetchData();
          refreshSummary?.();
        }}
      />

      <ConfirmDialog
        open={!!confirm}
        onClose={() => setConfirm(null)}
        onConfirm={handleDeactivate}
        title={`Deactivate ${confirm?.name || 'supplier'}?`}
        description="They will be hidden from new purchase orders. Past orders, payments, and returns remain unchanged."
        confirmLabel="Deactivate"
        variant="danger"
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

export default function SuppliersPage() {
  return (
    <RequirePermission permission="supplier.view">
      <SuppliersPageContent />
    </RequirePermission>
  );
}
