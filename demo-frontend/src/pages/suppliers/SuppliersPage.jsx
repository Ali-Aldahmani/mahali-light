import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
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
import PageHeader from '../../components/ui/PageHeader.jsx';
import Button from '../../components/ui/Button.jsx';
import Input from '../../components/ui/Input.jsx';
import Select from '../../components/ui/Select.jsx';
import Table from '../../components/ui/Table.jsx';
import Badge from '../../components/ui/Badge.jsx';
import EmptyState from '../../components/ui/EmptyState.jsx';
import PermissionGate from '../../components/ui/PermissionGate.jsx';
import ConfirmDialog from '../../components/ui/ConfirmDialog.jsx';
import { useDebouncedValue } from '../../hooks/useDebouncedValue.js';
import { useAuthStore } from '../../store/authStore.js';
import { useSupplierStore } from '../../store/supplierStore.js';
import { toast } from '../../store/toastStore.js';
import {
  listSuppliers,
  deactivateSupplier,
} from '../../services/supplierService.js';
import { formatCurrency, formatDate } from '../../utils/format.js';
import { onPurchaseOrderEvent } from '../../store/socketStore.js';
import SupplierFormSlideOver from './SupplierFormSlideOver.jsx';

const ACTIVE_OPTIONS = [
  { value: '', label: 'All suppliers' },
  { value: 'true', label: 'Active only' },
  { value: 'false', label: 'Inactive only' },
];

export default function SuppliersPage() {
  const navigate = useNavigate();
  const permissions = useAuthStore((s) => s.permissions);
  const canEdit = permissions.includes('supplier.edit');
  const canDelete = permissions.includes('supplier.delete');

  const [search, setSearch] = useState('');
  const [isActive, setIsActive] = useState('true');
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState([]);
  const [meta, setMeta] = useState(null);
  const [loading, setLoading] = useState(false);

  const [formOpen, setFormOpen] = useState(false);
  const [editingSupplier, setEditingSupplier] = useState(null);
  const [confirm, setConfirm] = useState(null);

  const debouncedSearch = useDebouncedValue(search, 250);
  const fetchSeq = useRef(0);

  const refreshSummary = useSupplierStore((s) => s.refreshSummary);

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

  const columns = useMemo(
    () => [
      {
        key: 'name',
        header: 'Supplier',
        render: (r) => (
          <div className="min-w-0">
            <button
              type="button"
              onClick={() => navigate(`/suppliers/${r.id}`)}
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
        render: (r) => r.phone || '—',
      },
      {
        key: 'totalSpent',
        header: 'Total spent',
        align: 'right',
        render: (r) => formatCurrency(r.totalSpent || 0),
      },
      {
        key: 'outstandingBalance',
        header: 'Outstanding',
        align: 'right',
        render: (r) => {
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
        render: (r) => (r.lastOrderDate ? formatDate(r.lastOrderDate) : '—'),
      },
      {
        key: 'status',
        header: 'Status',
        render: (r) => (
          <div className="flex items-center gap-1.5">
            <Badge tone={r.isActive ? 'success' : 'muted'} size="sm" dot>
              {r.isActive ? 'Active' : 'Inactive'}
            </Badge>
            {r.overdueCount > 0 && (
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
        align: 'right',
        render: (r) => (
          <div className="inline-flex items-center justify-end gap-1">
            <Button
              size="sm"
              variant="ghost"
              leftIcon={<Eye className="h-4 w-4" />}
              onClick={(e) => {
                e.stopPropagation();
                navigate(`/suppliers/${r.id}`);
              }}
            >
              View
            </Button>
            {canEdit && (
              <Button
                size="sm"
                variant="ghost"
                leftIcon={<Edit3 className="h-4 w-4" />}
                onClick={(e) => {
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
    [canEdit, canDelete, navigate],
  );

  async function handleDeactivate() {
    if (!confirm) return;
    try {
      await deactivateSupplier(confirm.id);
      toast.success(`${confirm.name} deactivated.`);
      setConfirm(null);
      fetchData();
    } catch (err) {
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
          tone={summary?.totalOutstanding > 0 ? 'warning' : 'default'}
        />
        <SummaryCard
          icon={<AlertCircle className="h-5 w-5" />}
          label="Overdue payments"
          value={summary?.overdueCount ?? 0}
          tone={summary?.overdueCount > 0 ? 'error' : 'default'}
        />
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-[260px]">
          <Input
            placeholder="Search by name, contact, phone, or email…"
            leftIcon={<Search className="h-4 w-4" />}
            value={search}
            onChange={(e) => {
              setPage(1);
              setSearch(e.target.value);
            }}
          />
        </div>
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
        onRowClick={(r) => navigate(`/suppliers/${r.id}`)}
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
