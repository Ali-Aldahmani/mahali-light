import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Lock,
  Unlock,
  Plus,
  Minus,
  History,
  AlertTriangle,
  Settings2,
} from 'lucide-react';
import Button from '../../../components/ui/Button.jsx';
import Input from '../../../components/ui/Input.jsx';
import Textarea from '../../../components/ui/Textarea.jsx';
import SlideOver from '../../../components/ui/SlideOver.jsx';
import Table from '../../../components/ui/Table.jsx';
import Tabs from '../../../components/ui/Tabs.jsx';
import CashTransactionTypeBadge from '../../../components/ui/CashTransactionTypeBadge.jsx';
import TransactionDirectionBadge from '../../../components/ui/TransactionDirectionBadge.jsx';
import DiscrepancyAlert from '../../../components/ui/DiscrepancyAlert.jsx';
import EmptyState from '../../../components/ui/EmptyState.jsx';
import PermissionGate from '../../../components/ui/PermissionGate.jsx';
import {
  getDrawerState,
  openDrawer,
  closeDrawer,
  adjustDrawer,
  listCashTransactions,
  listCashSessions,
} from '../../../services/cashDrawerService.js';
import { useTreasuryStore } from '../../../store/treasuryStore.js';
import { onTreasuryEvent } from '../../../store/socketStore.js';
import { toast } from '../../../store/toastStore.js';
import { formatCurrency, formatDateTime } from '../../../utils/format.js';
import ReconciliationSummary from './ReconciliationSummary.jsx';

export default function CashDrawerTab({ actionParam = null }) {
  const refreshStore = useTreasuryStore((s) => s.refresh);
  const [state, setState] = useState(null);
  const [openOpen, setOpenOpen] = useState(false);
  const [closeOpen, setCloseOpen] = useState(false);
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [view, setView] = useState('transactions');
  const [transactions, setTransactions] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [lastReconciliation, setLastReconciliation] = useState(null);

  const load = useCallback(async () => {
    try {
      const s = await getDrawerState();
      setState(s);
    } catch (_e) {
      // ignore
    }
  }, []);

  const loadTransactions = useCallback(async () => {
    try {
      const res = await listCashTransactions({ limit: 50 });
      setTransactions(res?.data || []);
    } catch (_e) {
      setTransactions([]);
    }
  }, []);

  const loadSessions = useCallback(async () => {
    try {
      const res = await listCashSessions({ limit: 25 });
      setSessions(res?.data || []);
    } catch (_e) {
      setSessions([]);
    }
  }, []);

  useEffect(() => {
    load();
    loadTransactions();
    loadSessions();
  }, [load, loadTransactions, loadSessions]);

  useEffect(
    () =>
      onTreasuryEvent((p) => {
        if (
          p.kind === 'cash_balance' ||
          p.kind === 'drawer_opened' ||
          p.kind === 'drawer_closed'
        ) {
          load();
          loadTransactions();
          loadSessions();
        }
      }),
    [load, loadTransactions, loadSessions],
  );

  useEffect(() => {
    if (actionParam === 'open') setOpenOpen(true);
    if (actionParam === 'close') setCloseOpen(true);
  }, [actionParam]);

  const isOpen = state?.status === 'open';
  const balance = Number(state?.currentBalance || 0);

  return (
    <div className="space-y-4">
      <div className="rounded-card border border-border bg-surface p-5 shadow-sm flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div className="flex items-center gap-4">
          <div
            className={`h-14 w-14 inline-flex items-center justify-center rounded-card ${
              isOpen
                ? 'bg-success-light text-success'
                : 'bg-surface-2 text-ink-muted'
            }`}
          >
            {isOpen ? <Unlock className="h-6 w-6" /> : <Lock className="h-6 w-6" />}
          </div>
          <div>
            <div className="text-xs text-ink-muted">
              {isOpen ? 'Drawer is open' : 'Drawer is closed'}
            </div>
            <div className="text-2xl font-semibold text-ink">
              {formatCurrency(balance)}
            </div>
            <div className="text-xs text-ink-muted mt-0.5">
              {isOpen
                ? `Session opened ${formatDateTime(state?.lastOpenedAt)} · by ${
                    state?.openedByUsername || 'unknown'
                  }`
                : state?.lastClosedAt
                  ? `Last closed ${formatDateTime(state.lastClosedAt)}`
                  : 'No previous session yet.'}
            </div>
          </div>
        </div>
        <PermissionGate permission="cash.adjust">
          <div className="flex flex-wrap gap-2">
            {!isOpen ? (
              <Button
                leftIcon={<Unlock className="h-4 w-4" />}
                onClick={() => setOpenOpen(true)}
              >
                Open drawer
              </Button>
            ) : (
              <Button
                variant="secondary"
                leftIcon={<Lock className="h-4 w-4" />}
                onClick={() => setCloseOpen(true)}
              >
                Close drawer
              </Button>
            )}
            <Button
              variant="secondary"
              leftIcon={<Settings2 className="h-4 w-4" />}
              onClick={() => setAdjustOpen(true)}
              disabled={!isOpen}
              title={!isOpen ? 'Open the drawer to make adjustments' : undefined}
            >
              Manual adjustment
            </Button>
          </div>
        </PermissionGate>
      </div>

      {lastReconciliation && (
        <ReconciliationSummary
          data={lastReconciliation}
          onClear={() => setLastReconciliation(null)}
        />
      )}

      <Tabs
        items={[
          { value: 'transactions', label: 'Transactions' },
          { value: 'sessions', label: 'Sessions history' },
        ]}
        value={view}
        onChange={setView}
      />

      {view === 'transactions' ? (
        <Table
          columns={[
            {
              key: 'timestamp',
              header: 'Time',
              render: (r) => formatDateTime(r.timestamp),
            },
            {
              key: 'transactionType',
              header: 'Type',
              render: (r) => <CashTransactionTypeBadge type={r.transactionType} />,
            },
            {
              key: 'direction',
              header: 'In / Out',
              render: (r) => (
                <TransactionDirectionBadge
                  direction={r.direction}
                  amount={r.amount}
                />
              ),
            },
            {
              key: 'balanceAfter',
              header: 'Balance after',
              align: 'right',
              render: (r) => formatCurrency(r.balanceAfter),
            },
            {
              key: 'referenceType',
              header: 'Reference',
              render: (r) =>
                r.referenceType
                  ? `${r.referenceType.replace(/_/g, ' ')}`
                  : '—',
            },
            {
              key: 'employeeUsername',
              header: 'By',
              render: (r) => r.employeeUsername || '—',
            },
          ]}
          rows={transactions}
          rowKey={(r) => r.id}
          empty="No transactions yet."
        />
      ) : (
        <Table
          columns={[
            {
              key: 'opened_at',
              header: 'Opened',
              render: (r) => formatDateTime(r.openedAt),
            },
            {
              key: 'opened_by_username',
              header: 'Opened by',
              render: (r) => r.openedByUsername || '—',
            },
            {
              key: 'opening_balance',
              header: 'Opening',
              align: 'right',
              render: (r) => formatCurrency(r.openingBalance),
            },
            {
              key: 'closing_balance',
              header: 'Closing',
              align: 'right',
              render: (r) =>
                r.closingBalance != null
                  ? formatCurrency(r.closingBalance)
                  : '—',
            },
            {
              key: 'discrepancy',
              header: 'Discrepancy',
              align: 'right',
              render: (r) => {
                if (r.discrepancy == null) return '—';
                const v = Number(r.discrepancy);
                const tone =
                  Math.abs(v) < 0.01
                    ? 'text-success'
                    : v > 0
                      ? 'text-warning'
                      : 'text-error';
                return (
                  <span className={tone}>
                    {v >= 0 ? '+' : '−'}
                    {formatCurrency(Math.abs(v))}
                  </span>
                );
              },
            },
            {
              key: 'closed_at',
              header: 'Closed',
              render: (r) =>
                r.closedAt ? formatDateTime(r.closedAt) : (
                  <span className="text-success font-medium">Open</span>
                ),
            },
          ]}
          rows={sessions}
          rowKey={(r) => r.id}
          empty="No sessions recorded yet."
        />
      )}

      <OpenDrawerSlideOver
        open={openOpen}
        onClose={() => setOpenOpen(false)}
        onDone={() => {
          load();
          loadTransactions();
          loadSessions();
          refreshStore();
        }}
      />

      <CloseDrawerSlideOver
        open={closeOpen}
        onClose={() => setCloseOpen(false)}
        expected={balance}
        onDone={(payload) => {
          setLastReconciliation(payload);
          load();
          loadTransactions();
          loadSessions();
          refreshStore();
        }}
      />

      <AdjustSlideOver
        open={adjustOpen}
        onClose={() => setAdjustOpen(false)}
        currentBalance={balance}
        onDone={() => {
          load();
          loadTransactions();
          refreshStore();
        }}
      />
    </div>
  );
}

function OpenDrawerSlideOver({ open, onClose, onDone }) {
  const [opening, setOpening] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setSaving(true);
    try {
      await openDrawer(Number(opening) || 0, notes || null);
      toast.success('Drawer opened.');
      onDone?.();
      onClose?.();
      setOpening('');
      setNotes('');
    } catch (err) {
      toast.error(err?.message || 'Could not open the drawer.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <SlideOver open={open} onClose={onClose} title="Open cash drawer" width="md">
      <form onSubmit={submit} className="space-y-4">
        <p className="text-sm text-ink-muted">
          Count the physical cash in the drawer and enter the total below.
          This becomes the opening balance for the new session.
        </p>
        <Input
          label="Opening balance (AED)"
          type="number"
          step="0.01"
          min="0"
          value={opening}
          onChange={(e) => setOpening(e.target.value)}
          required
          autoFocus
        />
        <Textarea
          label="Notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
        />
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={saving}>
            Open drawer
          </Button>
        </div>
      </form>
    </SlideOver>
  );
}

function CloseDrawerSlideOver({ open, onClose, expected, onDone }) {
  const [counted, setCounted] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [needsForce, setNeedsForce] = useState(false);

  useEffect(() => {
    if (open) {
      setCounted('');
      setNotes('');
      setNeedsForce(false);
    }
  }, [open]);

  const cnt = Number(counted) || 0;
  const diff = Math.round((cnt - Number(expected || 0)) * 100) / 100;
  const absDiff = Math.abs(diff);

  async function submit(e) {
    e.preventDefault();
    setSaving(true);
    try {
      const result = await closeDrawer({
        closingBalance: cnt,
        notes: notes || null,
        force: needsForce,
      });
      toast.success('Drawer closed.');
      onDone?.({
        expectedBalance: result.reconciliation.expectedBalance,
        countedBalance: result.reconciliation.countedBalance,
        discrepancy: result.reconciliation.discrepancy,
        sessionId: result.reconciliation.sessionId,
        at: new Date().toISOString(),
      });
      onClose?.();
    } catch (err) {
      if (err?.code === 'BIZ_DISCREPANCY_NEEDS_APPROVAL') {
        setNeedsForce(true);
        toast.warning(
          'This discrepancy is above the tolerance. Confirm again as manager.',
        );
      } else {
        toast.error(err?.message || 'Could not close the drawer.');
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <SlideOver open={open} onClose={onClose} title="Close cash drawer" width="md">
      <form onSubmit={submit} className="space-y-4">
        <div className="rounded-card bg-surface-2 px-4 py-3 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-ink-muted">Expected balance</span>
            <span className="font-semibold">{formatCurrency(expected)}</span>
          </div>
        </div>
        <Input
          label="Counted cash (AED)"
          type="number"
          step="0.01"
          min="0"
          value={counted}
          onChange={(e) => setCounted(e.target.value)}
          required
          autoFocus
        />
        <DiscrepancyAlert expected={expected} counted={cnt} />
        <Textarea
          label="Notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          hint={
            absDiff > 0.01
              ? 'A note is required when there is a discrepancy.'
              : undefined
          }
        />
        {needsForce && (
          <p className="text-xs text-warning bg-warning-light border border-warning/30 rounded-card px-3 py-2">
            Discrepancy is above tolerance. Submitting again will force-close
            the drawer with a manager override.
          </p>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={saving}>
            Close drawer
          </Button>
        </div>
      </form>
    </SlideOver>
  );
}

function AdjustSlideOver({ open, onClose, currentBalance, onDone }) {
  const [direction, setDirection] = useState('in');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setSaving(true);
    try {
      await adjustDrawer({
        amount: Number(amount) || 0,
        direction,
        reason,
      });
      toast.success('Adjustment recorded.');
      onDone?.();
      onClose?.();
      setAmount('');
      setReason('');
    } catch (err) {
      toast.error(err?.message || 'Could not record the adjustment.');
    } finally {
      setSaving(false);
    }
  }

  const amt = Number(amount) || 0;
  const after =
    direction === 'in' ? currentBalance + amt : currentBalance - amt;

  return (
    <SlideOver open={open} onClose={onClose} title="Cash adjustment" width="md">
      <form onSubmit={submit} className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={() => setDirection('in')}
            className={`rounded-card border px-4 py-3 text-sm font-medium inline-flex items-center justify-center gap-2 ${
              direction === 'in'
                ? 'border-success bg-success-light text-success'
                : 'border-border text-ink-muted hover:border-ink-muted'
            }`}
          >
            <Plus className="h-4 w-4" />
            Add cash
          </button>
          <button
            type="button"
            onClick={() => setDirection('out')}
            className={`rounded-card border px-4 py-3 text-sm font-medium inline-flex items-center justify-center gap-2 ${
              direction === 'out'
                ? 'border-error bg-error-light text-error'
                : 'border-border text-ink-muted hover:border-ink-muted'
            }`}
          >
            <Minus className="h-4 w-4" />
            Remove cash
          </button>
        </div>
        <Input
          label="Amount (AED)"
          type="number"
          step="0.01"
          min="0"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          required
        />
        <Textarea
          label="Reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={3}
          required
          placeholder="Explain why this adjustment is needed."
        />
        {amt > 0 && (
          <div className="rounded-card bg-surface-2 px-4 py-3 text-sm flex justify-between">
            <span className="text-ink-muted">Resulting balance</span>
            <span className="font-semibold">{formatCurrency(after)}</span>
          </div>
        )}
        {direction === 'out' && amt > currentBalance && (
          <p className="text-sm text-error inline-flex items-center gap-2">
            <AlertTriangle className="h-4 w-4" />
            Insufficient cash. The drawer can't go negative.
          </p>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="submit"
            loading={saving}
            disabled={direction === 'out' && amt > currentBalance}
          >
            Save adjustment
          </Button>
        </div>
      </form>
    </SlideOver>
  );
}
