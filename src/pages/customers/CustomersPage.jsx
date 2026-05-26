import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
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
import PageHeader from '../../components/ui/PageHeader.jsx';
import Button from '../../components/ui/Button.jsx';
import Input from '../../components/ui/Input.jsx';
import Select from '../../components/ui/Select.jsx';
import Table from '../../components/ui/Table.jsx';
import Badge from '../../components/ui/Badge.jsx';
import EmptyState from '../../components/ui/EmptyState.jsx';
import PermissionGate from '../../components/ui/PermissionGate.jsx';
import ConfirmDialog from '../../components/ui/ConfirmDialog.jsx';
import CustomerAvatar from '../../components/ui/CustomerAvatar.jsx';
import CreditBalanceBadge from '../../components/ui/CreditBalanceBadge.jsx';
import { useDebouncedValue } from '../../hooks/useDebouncedValue.js';
import { useAuthStore } from '../../store/authStore.js';
import { useCustomerStore } from '../../store/customerStore.js';
import { toast } from '../../store/toastStore.js';
import {
  listCustomers,
  deactivateCustomer,
} from '../../services/customerService.js';
import { formatCurrency, formatDate } from '../../utils/format.js';
import { onCustomerBalanceUpdate } from '../../store/socketStore.js';
import CustomerFormSlideOver from './CustomerFormSlideOver.jsx';
import CollectPaymentSlideOver from './CollectPaymentSlideOver.jsx';

const ACTIVE_OPTIONS = [
  { value: '', label: 'All customers' },
  { value: 'true', label: 'Active only' },
  { value: 'false', label: 'Inactive only' },
];

const BALANCE_OPTIONS = [
  { value: '', label: 'Any balance' },
  { value: 'true', label: 'With balance' },
];

export default function CustomersPage() {
  const navigate = useNavigate();
  const permissions = useAuthStore((s) => s.permissions);
  const canEdit = permissions.includes('customer.edit');
  const canDelete = permissions.includes('customer.delete');
  const canCollect = permissions.includes('customer.collect_payment');
  const canSeeBalance = permissions.includes('customer.view_balance');

  const [search, setSearch] = useState('');
  const [isActive, setIsActive] = useState('true');
  const [hasBalance, setHasBalance] = useState('');
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState([]);
  const [meta, setMeta] = useState(null);
  const [loading, setLoading] = useState(false);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const [payingCustomer, setPayingCustomer] = useState(null);

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

  const columns = useMemo(
    () => [
      {
        key: 'name',
        header: 'Customer',
        render: (r) => (
          <div className="flex items-center gap-2 min-w-0">
            <CustomerAvatar customer={r} size="sm" />
            <div className="min-w-0">
              <button
                type="button"
                onClick={() => navigate(`/customers/${r.id}`)}
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
        render: (r) => r.phone || '—',
      },
      {
        key: 'totalSpent',
        header: 'Total spent',
        align: 'right',
        render: (r) => formatCurrency(r.totalSpent || 0),
      },
      ...(canSeeBalance
        ? [
            {
              key: 'creditBalance',
              header: 'Balance',
              align: 'right',
              render: (r) => (
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
        render: (r) =>
          r.lastPurchaseDate ? formatDate(r.lastPurchaseDate) : '—',
      },
      {
        key: 'status',
        header: 'Status',
        render: (r) => (
          <Badge tone={r.isActive ? 'success' : 'muted'} size="sm" dot>
            {r.isActive ? 'Active' : 'Inactive'}
          </Badge>
        ),
      },
      {
        key: 'actions',
        header: '',
        sortable: false,
        align: 'right',
        render: (r) => (
          <div className="inline-flex items-center justify-end gap-1">
            <Button
              size="sm"
              variant="ghost"
              leftIcon={<Eye className="h-4 w-4" />}
              onClick={(e) => {
                e.stopPropagation();
                navigate(`/customers/${r.id}`);
              }}
            >
              View
            </Button>
            {canCollect && r.creditBalance > 0 && (
              <Button
                size="sm"
                variant="ghost"
                leftIcon={<CreditCard className="h-4 w-4" />}
                onClick={(e) => {
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
                onClick={(e) => {
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
                onClick={(e) => {
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
    [canEdit, canDelete, canCollect, canSeeBalance, navigate],
  );

  async function handleDeactivate() {
    if (!confirm) return;
    try {
      await deactivateCustomer(confirm.id);
      toast.success(`${confirm.name} deactivated.`);
      setConfirm(null);
      fetchData();
      refreshSummary?.();
    } catch (err) {
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
              onClick={() => navigate('/customers/outstanding')}
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
          tone={summary?.totalOutstanding > 0 ? 'warning' : 'default'}
        />
        <SummaryCard
          icon={<AlertCircle className="h-5 w-5" />}
          label="With balance"
          value={summary?.customersWithBalance ?? 0}
          tone={summary?.customersWithBalance > 0 ? 'warning' : 'default'}
        />
        <SummaryCard
          icon={<TrendingUp className="h-5 w-5" />}
          label="New this month"
          value={summary?.newThisMonth ?? 0}
          tone={summary?.newThisMonth > 0 ? 'success' : 'default'}
        />
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-[260px]">
          <Input
            placeholder="Search by name, phone, company, or email…"
            leftIcon={<Search className="h-4 w-4" />}
            value={search}
            onChange={(e) => {
              setPage(1);
              setSearch(e.target.value);
            }}
          />
        </div>
        {canSeeBalance && (
          <div className="w-48">
            <Select
              value={hasBalance}
              onChange={(v) => {
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
            onChange={(v) => {
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
        rowKey={(r) => r.id}
        loading={loading}
        onRowClick={(r) => navigate(`/customers/${r.id}`)}
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
