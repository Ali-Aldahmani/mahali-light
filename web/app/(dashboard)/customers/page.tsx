'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Plus,
  Search,
  Users,
  Wallet,
  AlertCircle,
  TrendingUp,
  Edit3,
  Power,
  Eye,
  CreditCard,
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
import CustomerAvatar from '@/components/ui/CustomerAvatar';
import CreditBalanceBadge from '@/components/ui/CreditBalanceBadge';
import RequirePermission from '@/components/guards/RequirePermission';
import CustomerFormSlideOver, {
  type CustomerRecord,
} from '@/components/customers/CustomerFormSlideOver';
import CollectPaymentSlideOver from '@/components/customers/CollectPaymentSlideOver';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { useAuthStore } from '@/store/authStore';
import { useCustomerStore } from '@/store/customerStore';
import { toast } from '@/store/toastStore';
import { listCustomers, deactivateCustomer } from '@/services/customerService';
import { formatCurrency, formatDate } from '@/lib/utils/format';
import { onCustomerBalanceUpdate } from '@/store/socketStore';

interface CustomerRow extends CustomerRecord {
  totalSpent?: number;
  creditBalance?: number;
  lastPurchaseDate?: string | null;
}

interface ListMeta {
  limit?: number;
  total?: number;
  totals?: {
    totalCustomers?: number;
    totalOutstanding?: number;
    customersWithBalance?: number;
    newThisMonth?: number;
  };
}

const ACTIVE_OPTIONS = [
  { value: '', label: 'All customers' },
  { value: 'true', label: 'Active only' },
  { value: 'false', label: 'Inactive only' },
];

const BALANCE_OPTIONS = [
  { value: '', label: 'Any balance' },
  { value: 'true', label: 'With balance' },
];

function CustomersPageContent() {
  const router = useRouter();
  const permissions = useAuthStore((s) => s.permissions);
  const canEdit = permissions.includes('customer.edit');
  const canDelete = permissions.includes('customer.delete');
  const canCollect = permissions.includes('customer.collect_payment');
  const canSeeBalance = permissions.includes('customer.view_balance');

  const [search, setSearch] = useState('');
  const [isActive, setIsActive] = useState('true');
  const [hasBalance, setHasBalance] = useState('');
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<CustomerRow[]>([]);
  const [meta, setMeta] = useState<ListMeta | null>(null);
  const [loading, setLoading] = useState(false);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<CustomerRow | null>(null);
  const [confirm, setConfirm] = useState<CustomerRow | null>(null);
  const [payingCustomer, setPayingCustomer] = useState<CustomerRow | null>(null);

  const debouncedSearch = useDebouncedValue(search, 250);
  const fetchSeq = useRef(0);

  const refreshSummary = useCustomerStore((s) => s.refreshSummary);

  async function fetchData() {
    const seq = ++fetchSeq.current;
    setLoading(true);
    try {
      const res = await listCustomers({
        page,
        limit: 25,
        search: debouncedSearch || undefined,
        isActive: isActive || undefined,
        hasBalance: hasBalance || undefined,
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
  }, [page, debouncedSearch, isActive, hasBalance]);

  useEffect(() => {
    refreshSummary?.();
  }, [refreshSummary]);

  useEffect(() => {
    return onCustomerBalanceUpdate(() => {
      fetchData();
      refreshSummary?.();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const summary = meta?.totals;

  const columns = useMemo<TableColumn[]>(
    () => [
      {
        key: 'name',
        header: 'Customer',
        render: (r: CustomerRow) => (
          <div className="flex items-center gap-2 min-w-0">
            <CustomerAvatar customer={r} size="sm" />
            <div className="min-w-0">
              <button
                type="button"
                onClick={() => router.push(`/customers/${r.id}`)}
                className="text-sm font-medium text-ink hover:text-accent text-left truncate block max-w-[240px]"
                title={r.name}
              >
                {r.name}
              </button>
              <div className="text-xs text-ink-muted truncate">
                {r.companyName || '—'}
              </div>
            </div>
          </div>
        ),
      },
      {
        key: 'phone',
        header: 'Phone',
        render: (r: CustomerRow) => r.phone || '—',
      },
      {
        key: 'totalSpent',
        header: 'Total spent',
        align: 'right' as const,
        render: (r: CustomerRow) => formatCurrency(r.totalSpent || 0),
      },
      ...(canSeeBalance
        ? [
            {
              key: 'creditBalance',
              header: 'Balance',
              align: 'right' as const,
              render: (r: CustomerRow) => (
                <CreditBalanceBadge
                  balance={r.creditBalance}
                  limit={r.creditLimit}
                />
              ),
            },
          ]
        : []),
      {
        key: 'lastPurchaseDate',
        header: 'Last purchase',
        render: (r: CustomerRow) =>
          r.lastPurchaseDate ? formatDate(r.lastPurchaseDate) : '—',
      },
      {
        key: 'status',
        header: 'Status',
        render: (r: CustomerRow) => (
          <Badge tone={r.isActive ? 'success' : 'muted'} size="sm" dot>
            {r.isActive ? 'Active' : 'Inactive'}
          </Badge>
        ),
      },
      {
        key: 'actions',
        header: '',
        sortable: false,
        align: 'right' as const,
        render: (r: CustomerRow) => (
          <div className="inline-flex items-center justify-end gap-1">
            <Button
              size="sm"
              variant="ghost"
              leftIcon={<Eye className="h-4 w-4" />}
              onClick={(e: React.MouseEvent) => {
                e.stopPropagation();
                router.push(`/customers/${r.id}`);
              }}
            >
              View
            </Button>
            {canCollect && (r.creditBalance || 0) > 0 && (
              <Button
                size="sm"
                variant="ghost"
                leftIcon={<CreditCard className="h-4 w-4" />}
                onClick={(e: React.MouseEvent) => {
                  e.stopPropagation();
                  setPayingCustomer(r);
                }}
              >
                Collect
              </Button>
            )}
            {canEdit && (
              <Button
                size="sm"
                variant="ghost"
                leftIcon={<Edit3 className="h-4 w-4" />}
                onClick={(e: React.MouseEvent) => {
                  e.stopPropagation();
                  setEditing(r);
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
    [canEdit, canDelete, canCollect, canSeeBalance, router],
  );

  async function handleDeactivate() {
    if (!confirm) return;
    try {
      await deactivateCustomer(confirm.id);
      toast.success(`${confirm.name} deactivated.`);
      setConfirm(null);
      fetchData();
      refreshSummary?.();
    } catch (err: any) {
      toast.error(err?.message || 'Failed to deactivate customer.');
      setConfirm(null);
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Customers"
        subtitle="Track customer profiles, credit balances, and purchase history."
        action={
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              onClick={() => router.push('/customers/outstanding')}
            >
              Receivables
            </Button>
            <PermissionGate permission="customer.create">
              <Button
                leftIcon={<Plus className="h-4 w-4" />}
                onClick={() => {
                  setEditing(null);
                  setFormOpen(true);
                }}
              >
                Add customer
              </Button>
            </PermissionGate>
          </div>
        }
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <SummaryCard
          icon={<Users className="h-5 w-5" />}
          label="Total customers"
          value={summary?.totalCustomers ?? '—'}
        />
        <SummaryCard
          icon={<Wallet className="h-5 w-5" />}
          label="Total outstanding"
          value={
            canSeeBalance && summary?.totalOutstanding != null
              ? formatCurrency(summary.totalOutstanding)
              : '—'
          }
          tone={(summary?.totalOutstanding || 0) > 0 ? 'warning' : 'default'}
        />
        <SummaryCard
          icon={<AlertCircle className="h-5 w-5" />}
          label="With balance"
          value={summary?.customersWithBalance ?? 0}
          tone={(summary?.customersWithBalance || 0) > 0 ? 'warning' : 'default'}
        />
        <SummaryCard
          icon={<TrendingUp className="h-5 w-5" />}
          label="New this month"
          value={summary?.newThisMonth ?? 0}
          tone={(summary?.newThisMonth || 0) > 0 ? 'success' : 'default'}
        />
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-[260px]">
          <Input
            placeholder="Search by name, phone, company, or email…"
            leftIcon={<Search className="h-4 w-4" />}
            value={search}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
              setPage(1);
              setSearch(e.target.value);
            }}
          />
        </div>
        {canSeeBalance && (
          <div className="w-48">
            <Select
              value={hasBalance}
              onChange={(v: string) => {
                setPage(1);
                setHasBalance(v);
              }}
              options={BALANCE_OPTIONS}
              searchable={false}
            />
          </div>
        )}
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
        rowKey={(r: CustomerRow) => r.id}
        loading={loading}
        onRowClick={(r: CustomerRow) => router.push(`/customers/${r.id}`)}
        empty={
          <EmptyState
            title="No customers"
            description="Add your first customer to start recording invoices and collecting payments."
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

      <CustomerFormSlideOver
        open={formOpen}
        onClose={() => setFormOpen(false)}
        customer={editing}
        onSaved={() => {
          fetchData();
          refreshSummary?.();
        }}
      />

      <CollectPaymentSlideOver
        open={!!payingCustomer}
        onClose={() => setPayingCustomer(null)}
        customer={payingCustomer}
        onCollected={() => {
          fetchData();
          refreshSummary?.();
        }}
      />

      <ConfirmDialog
        open={!!confirm}
        onClose={() => setConfirm(null)}
        onConfirm={handleDeactivate}
        title={`Deactivate ${confirm?.name || 'customer'}?`}
        description="They will be hidden from new invoices and the POS picker. Existing records remain unchanged."
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

export default function CustomersPage() {
  return (
    <RequirePermission permission="customer.view">
      <CustomersPageContent />
    </RequirePermission>
  );
}
