import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertCircle,
  Pencil,
  Pause,
  Play,
  XCircle,
  CreditCard,
  Eye,
} from 'lucide-react';
import Table from '../../../components/ui/Table.jsx';
import Button from '../../../components/ui/Button.jsx';
import BillStatusBadge from '../../../components/ui/BillStatusBadge.jsx';
import DaysUntilDueBadge from '../../../components/ui/DaysUntilDueBadge.jsx';
import BillPaymentStatusBadge from '../../../components/ui/BillPaymentStatusBadge.jsx';
import ExpenseCategoryIcon from '../../../components/ui/ExpenseCategoryIcon.jsx';
import BillCard from '../../../components/ui/BillCard.jsx';
import AnnualBillsCalendar from '../../../components/ui/AnnualBillsCalendar.jsx';
import ConfirmDialog from '../../../components/ui/ConfirmDialog.jsx';
import EmptyState from '../../../components/ui/EmptyState.jsx';
import BillFormSlideOver from '../../../components/bills/BillFormSlideOver.jsx';
import PayBillSlideOver from '../../../components/bills/PayBillSlideOver.jsx';
import {
  listBills,
  listBillPayments,
  cancelBill,
  pauseBill,
  resumeBill,
} from '../../../services/billService.js';
import { useBillStore } from '../../../store/billStore.js';
import { useAuthStore } from '../../../store/authStore.js';
import { toast } from '../../../store/toastStore.js';

function aed(n) {
  return `AED ${Number(n || 0).toFixed(2)}`;
}

export default function BillsTab({ refreshTick, onAddBill, onMutated }) {
  const navigate = useNavigate();
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const upcoming = useBillStore((s) => s.upcoming);
  const refreshUpcoming = useBillStore((s) => s.refreshUpcoming);

  const [bills, setBills] = useState([]);
  const [payments, setPayments] = useState([]);
  const [filterStatus, setFilterStatus] = useState('');
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState(null);
  const [paying, setPaying] = useState(null);
  const [confirm, setConfirm] = useState(null);

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    Promise.all([
      listBills(filterStatus ? { status: filterStatus } : {})
        .then((r) => r?.data || [])
        .catch(() => []),
      listBillPayments({ limit: 200 })
        .then((r) => r?.data || [])
        .catch(() => []),
    ])
      .then(([b, p]) => {
        if (!mounted) return;
        setBills(b);
        setPayments(p);
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [refreshTick, filterStatus]);

  const totals = upcoming?.totals;
  const attention = useMemo(() => {
    const buckets = upcoming?.buckets || {};
    return [
      ...(buckets.overdue || []),
      ...(buckets.dueToday || []),
      ...(buckets.thisWeek || []).slice(0, 5),
    ];
  }, [upcoming]);

  async function onSetStatus(bill, action) {
    try {
      if (action === 'cancel') await cancelBill(bill.id);
      else if (action === 'pause') await pauseBill(bill.id);
      else if (action === 'resume') await resumeBill(bill.id);
      toast.success(`Bill ${action === 'cancel' ? 'cancelled' : action + 'd'}.`);
      onMutated?.();
      refreshUpcoming();
    } catch (err) {
      toast.error(err?.message || 'Failed to update bill.');
    }
  }

  function onPayClick(billPayment) {
    setPaying(billPayment);
  }

  const columns = [
    {
      key: 'name',
      header: 'Bill',
      render: (b) => (
        <div className="flex items-center gap-2 min-w-0">
          <ExpenseCategoryIcon icon={b.categoryIcon} name="" hideName />
          <div className="min-w-0">
            <div className="truncate font-medium">{b.name}</div>
            <div className="truncate text-xs text-ink-muted">
              {b.vendorName || b.categoryName || '—'}
            </div>
          </div>
        </div>
      ),
    },
    {
      key: 'frequency',
      header: 'Frequency',
      render: (b) => <span className="capitalize text-sm">{b.frequency}</span>,
    },
    {
      key: 'amount',
      header: 'Expected',
      align: 'right',
      render: (b) =>
        b.isVariableAmount ? (
          <span className="text-xs text-ink-muted">Variable</span>
        ) : (
          aed(b.amount)
        ),
    },
    {
      key: 'nextDueDate',
      header: 'Next due',
      render: (b) => (
        <div className="flex flex-col">
          <span className="text-sm">{b.nextDueDate || '—'}</span>
          {b.upcomingPaymentStatus && (
            <BillPaymentStatusBadge status={b.upcomingPaymentStatus} />
          )}
        </div>
      ),
    },
    {
      key: 'daysUntilDue',
      header: 'In',
      render: (b) => <DaysUntilDueBadge days={b.daysUntilDue} />,
    },
    {
      key: 'paymentMethod',
      header: 'Method',
      render: (b) => (
        <div className="text-sm">
          <div className="capitalize">{b.paymentMethod}</div>
          {b.bankName && (
            <div className="text-xs text-ink-muted">{b.bankName}</div>
          )}
        </div>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (b) => <BillStatusBadge status={b.status} />,
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (b) => (
        <div className="flex items-center justify-end gap-1">
          <button
            type="button"
            onClick={() => navigate(`/expenses/bills/${b.id}`)}
            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-ink-muted hover:bg-surface-2"
            title="View"
          >
            <Eye size={16} />
          </button>
          {hasPermission('bills.pay') &&
            b.upcomingPaymentId &&
            b.status === 'active' && (
              <button
                type="button"
                onClick={() => {
                  // Use the matching payment row from the list query above so
                  // the slide-over has all the meta it needs.
                  const p = payments.find((p) => p.id === b.upcomingPaymentId);
                  if (p) onPayClick(p);
                }}
                className="inline-flex h-8 w-8 items-center justify-center rounded-md text-accent hover:bg-accent-light"
                title="Pay"
              >
                <CreditCard size={16} />
              </button>
            )}
          {hasPermission('bills.manage') && b.status !== 'cancelled' && (
            <>
              <button
                type="button"
                onClick={() => setEditing(b)}
                className="inline-flex h-8 w-8 items-center justify-center rounded-md text-ink-muted hover:bg-surface-2"
                title="Edit"
              >
                <Pencil size={16} />
              </button>
              {b.status === 'active' ? (
                <button
                  type="button"
                  onClick={() =>
                    setConfirm({
                      action: 'pause',
                      bill: b,
                      title: 'Pause this bill?',
                      message:
                        'No reminders or new payment cycles will be generated until it is resumed.',
                    })
                  }
                  className="inline-flex h-8 w-8 items-center justify-center rounded-md text-warning hover:bg-warning-light"
                  title="Pause"
                >
                  <Pause size={16} />
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => onSetStatus(b, 'resume')}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-md text-success hover:bg-success-light"
                  title="Resume"
                >
                  <Play size={16} />
                </button>
              )}
              <button
                type="button"
                onClick={() =>
                  setConfirm({
                    action: 'cancel',
                    bill: b,
                    title: 'Cancel this bill?',
                    message:
                      'The bill will be marked cancelled and no further payments will be tracked.',
                  })
                }
                className="inline-flex h-8 w-8 items-center justify-center rounded-md text-error hover:bg-error-light"
                title="Cancel"
              >
                <XCircle size={16} />
              </button>
            </>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <SummaryCard
          label="Monthly bills"
          value={aed(totals?.monthlyRecurringTotal)}
          tone="neutral"
          hint="Active monthly recurring"
        />
        <SummaryCard
          label="Overdue"
          value={aed(totals?.overdueAmount)}
          tone={Number(totals?.overdueAmount) > 0 ? 'error' : 'neutral'}
          hint={`${upcoming?.buckets?.overdue?.length || 0} payment(s)`}
        />
        <SummaryCard
          label="Due this week"
          value={aed(totals?.dueThisWeekAmount)}
          tone="warning"
          hint={`${
            (upcoming?.buckets?.dueToday?.length || 0) +
            (upcoming?.buckets?.thisWeek?.length || 0)
          } payment(s)`}
        />
        <SummaryCard
          label="Paid this month"
          value={aed(totals?.paidThisMonth)}
          tone="success"
        />
      </div>

      {/* Bills requiring attention */}
      {attention.length > 0 && (
        <div className="rounded-card border border-border bg-surface shadow-soft">
          <div className="flex items-center gap-2 border-b border-border px-4 py-3">
            <AlertCircle size={16} className="text-error" />
            <h3 className="font-medium">Bills requiring attention</h3>
          </div>
          <div className="space-y-2 p-4">
            {attention.map((b) => (
              <BillCard
                key={b.id}
                bill={b}
                onPay={hasPermission('bills.pay') ? onPayClick : null}
              />
            ))}
          </div>
        </div>
      )}

      {/* Filter + table */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <label className="text-sm text-ink-muted">Status</label>
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            className="h-9 rounded-input border border-border bg-surface px-3 text-sm"
          >
            <option value="">All</option>
            <option value="active">Active</option>
            <option value="paused">Paused</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </div>
        {hasPermission('bills.manage') && (
          <Button size="sm" variant="secondary" onClick={onAddBill}>
            + Add bill
          </Button>
        )}
      </div>

      <Table
        columns={columns}
        rows={bills}
        rowKey={(b) => b.id}
        loading={loading}
        empty={
          <EmptyState
            title="No bills yet"
            description="Add the recurring bills you want to track."
          />
        }
      />

      <AnnualBillsCalendar
        payments={payments}
        onSelectMonth={(b) => {
          if (!b?.payments?.length) return;
          // Drill-down: pick the first non-paid one to highlight.
          const open = b.payments.find((p) => p.status !== 'paid');
          if (open) navigate(`/expenses/bills/${open.billId}`);
        }}
      />

      <BillFormSlideOver
        open={!!editing}
        bill={editing}
        onClose={() => setEditing(null)}
        onSaved={onMutated}
      />
      <PayBillSlideOver
        open={!!paying}
        payment={paying}
        bill={bills.find((b) => b.id === paying?.billId)}
        onClose={() => setPaying(null)}
        onPaid={onMutated}
      />
      <ConfirmDialog
        open={!!confirm}
        title={confirm?.title}
        description={confirm?.message}
        confirmLabel={confirm?.action === 'cancel' ? 'Cancel bill' : 'Pause bill'}
        variant={confirm?.action === 'cancel' ? 'danger' : 'primary'}
        onClose={() => setConfirm(null)}
        onConfirm={() => {
          const c = confirm;
          setConfirm(null);
          onSetStatus(c.bill, c.action);
        }}
      />
    </div>
  );
}

function SummaryCard({ label, value, tone = 'neutral', hint }) {
  const toneClass =
    tone === 'error'
      ? 'border-error/30 bg-error-light'
      : tone === 'warning'
      ? 'border-warning/30 bg-warning-light'
      : tone === 'success'
      ? 'border-success/30 bg-success-light'
      : 'border-border bg-surface';
  return (
    <div
      className={`rounded-card border p-4 shadow-soft ${toneClass}`}
    >
      <div className="text-xs uppercase tracking-wider text-ink-muted">
        {label}
      </div>
      <div className="mt-1 text-xl font-semibold">{value}</div>
      {hint && <div className="mt-0.5 text-xs text-ink-muted">{hint}</div>}
    </div>
  );
}
