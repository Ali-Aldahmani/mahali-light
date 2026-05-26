import { useCallback, useEffect, useState } from 'react';
import {
  Building2,
  Plus,
  ArrowDownToLine,
  ArrowUpFromLine,
  ArrowLeftRight,
  History,
  Star,
} from 'lucide-react';
import Button from '../../../components/ui/Button.jsx';
import Input from '../../../components/ui/Input.jsx';
import Textarea from '../../../components/ui/Textarea.jsx';
import Select from '../../../components/ui/Select.jsx';
import SlideOver from '../../../components/ui/SlideOver.jsx';
import Table from '../../../components/ui/Table.jsx';
import EmptyState from '../../../components/ui/EmptyState.jsx';
import PermissionGate from '../../../components/ui/PermissionGate.jsx';
import CashTransactionTypeBadge from '../../../components/ui/CashTransactionTypeBadge.jsx';
import TransactionDirectionBadge from '../../../components/ui/TransactionDirectionBadge.jsx';
import Badge from '../../../components/ui/Badge.jsx';
import {
  listBankAccounts,
  createBankAccount,
  bankDeposit,
  bankWithdrawal,
  listBankTransactions,
} from '../../../services/bankAccountService.js';
import { useTreasuryStore } from '../../../store/treasuryStore.js';
import { onTreasuryEvent } from '../../../store/socketStore.js';
import { toast } from '../../../store/toastStore.js';
import { formatCurrency, formatDateTime } from '../../../utils/format.js';

export default function BankAccountsTab() {
  const refreshStore = useTreasuryStore((s) => s.refresh);
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [addOpen, setAddOpen] = useState(false);
  const [activeId, setActiveId] = useState(null);
  const [action, setAction] = useState(null); // 'deposit' | 'withdraw' | 'history'

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await listBankAccounts({ includeInactive: true });
      setAccounts(data);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(
    () =>
      onTreasuryEvent((p) => {
        if (p.kind === 'bank_balance') load();
      }),
    [load],
  );

  const active = accounts.find((a) => a.id === activeId);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm font-semibold text-ink">Bank accounts</div>
          <div className="text-xs text-ink-muted">
            All accounts contribute to the treasury overview total.
          </div>
        </div>
        <PermissionGate permission="bank.transact">
          <Button
            leftIcon={<Plus className="h-4 w-4" />}
            onClick={() => setAddOpen(true)}
          >
            Add bank account
          </Button>
        </PermissionGate>
      </div>

      {loading ? (
        <div className="card p-12 text-center text-ink-muted">Loading…</div>
      ) : accounts.length === 0 ? (
        <EmptyState
          icon={<Building2 />}
          title="No bank accounts yet"
          description="Add your first account to start recording bank deposits, withdrawals and transfers."
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {accounts.map((a) => (
            <BankAccountCard
              key={a.id}
              account={a}
              onAction={(act) => {
                setActiveId(a.id);
                setAction(act);
              }}
            />
          ))}
        </div>
      )}

      <CreateBankSlideOver
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onDone={() => {
          load();
          refreshStore();
        }}
      />

      {active && action === 'deposit' && (
        <DepositSlideOver
          account={active}
          open
          onClose={() => setAction(null)}
          onDone={() => {
            load();
            refreshStore();
          }}
        />
      )}
      {active && action === 'withdraw' && (
        <WithdrawSlideOver
          account={active}
          open
          onClose={() => setAction(null)}
          onDone={() => {
            load();
            refreshStore();
          }}
        />
      )}
      {active && action === 'history' && (
        <HistorySlideOver
          account={active}
          open
          onClose={() => setAction(null)}
        />
      )}
    </div>
  );
}

function BankAccountCard({ account, onAction }) {
  return (
    <div className="rounded-card border border-border bg-surface p-5 shadow-sm">
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-start gap-3">
          <div className="h-10 w-10 inline-flex items-center justify-center rounded-md bg-accent-light text-accent">
            <Building2 className="h-5 w-5" />
          </div>
          <div>
            <div className="text-base font-semibold text-ink">
              {account.bankName}
            </div>
            <div className="text-xs text-ink-muted">{account.accountName}</div>
            {account.accountNumber && (
              <div className="text-xs text-ink-muted">
                Account: **** {account.accountNumber.slice(-4)}
              </div>
            )}
            {account.iban && (
              <div className="text-xs text-ink-muted truncate">
                {account.iban}
              </div>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {account.isDefault && (
            <Badge tone="accent" size="sm">
              <Star className="h-3 w-3" />
              Default
            </Badge>
          )}
          {!account.isActive && (
            <Badge tone="muted" size="sm">
              Inactive
            </Badge>
          )}
        </div>
      </div>

      <div className="rounded-card bg-surface-2 p-3 mb-3">
        <div className="text-xs text-ink-muted">Balance</div>
        <div
          className={`text-2xl font-semibold ${
            Number(account.currentBalance) < 0 ? 'text-error' : 'text-ink'
          }`}
        >
          {formatCurrency(account.currentBalance || 0)} {account.currency || 'AED'}
        </div>
        {account.lastActivityAt && (
          <div className="text-[11px] text-ink-muted mt-1">
            Last activity {formatDateTime(account.lastActivityAt)}
          </div>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          variant="secondary"
          size="sm"
          leftIcon={<History className="h-3.5 w-3.5" />}
          onClick={() => onAction('history')}
        >
          History
        </Button>
        <PermissionGate permission="bank.transact">
          <Button
            variant="secondary"
            size="sm"
            leftIcon={<ArrowDownToLine className="h-3.5 w-3.5" />}
            onClick={() => onAction('deposit')}
          >
            Deposit
          </Button>
          <Button
            variant="secondary"
            size="sm"
            leftIcon={<ArrowUpFromLine className="h-3.5 w-3.5" />}
            onClick={() => onAction('withdraw')}
          >
            Withdraw
          </Button>
        </PermissionGate>
      </div>
    </div>
  );
}

function CreateBankSlideOver({ open, onClose, onDone }) {
  const [form, setForm] = useState({
    bankName: '',
    accountName: '',
    accountNumber: '',
    iban: '',
    currency: 'AED',
    openingBalance: '',
    isDefault: false,
    notes: '',
  });
  const [saving, setSaving] = useState(false);

  function update(key, value) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function submit(e) {
    e.preventDefault();
    setSaving(true);
    try {
      await createBankAccount({
        ...form,
        openingBalance: Number(form.openingBalance) || 0,
      });
      toast.success('Bank account added.');
      onDone?.();
      onClose?.();
    } catch (err) {
      toast.error(err?.message || 'Could not create account.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <SlideOver open={open} onClose={onClose} title="Add bank account" width="md">
      <form onSubmit={submit} className="space-y-3">
        <Input
          label="Bank name"
          value={form.bankName}
          onChange={(e) => update('bankName', e.target.value)}
          required
          autoFocus
        />
        <Input
          label="Account name"
          value={form.accountName}
          onChange={(e) => update('accountName', e.target.value)}
          required
        />
        <div className="grid grid-cols-2 gap-3">
          <Input
            label="Account number"
            value={form.accountNumber}
            onChange={(e) => update('accountNumber', e.target.value)}
          />
          <Input
            label="Currency"
            value={form.currency}
            onChange={(e) => update('currency', e.target.value)}
          />
        </div>
        <Input
          label="IBAN"
          value={form.iban}
          onChange={(e) => update('iban', e.target.value)}
        />
        <Input
          label="Opening balance (AED)"
          type="number"
          step="0.01"
          value={form.openingBalance}
          onChange={(e) => update('openingBalance', e.target.value)}
        />
        <label className="inline-flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={form.isDefault}
            onChange={(e) => update('isDefault', e.target.checked)}
          />
          Make this the default bank account
        </label>
        <Textarea
          label="Notes"
          value={form.notes}
          onChange={(e) => update('notes', e.target.value)}
          rows={2}
        />
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={saving}>
            Create account
          </Button>
        </div>
      </form>
    </SlideOver>
  );
}

function DepositSlideOver({ account, open, onClose, onDone }) {
  return (
    <BankMovementSlideOver
      account={account}
      open={open}
      onClose={onClose}
      onDone={onDone}
      mode="deposit"
    />
  );
}

function WithdrawSlideOver({ account, open, onClose, onDone }) {
  return (
    <BankMovementSlideOver
      account={account}
      open={open}
      onClose={onClose}
      onDone={onDone}
      mode="withdraw"
    />
  );
}

function BankMovementSlideOver({ account, open, onClose, onDone, mode }) {
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [description, setDescription] = useState('');
  const [notes, setNotes] = useState('');
  const [allowOverdraft, setAllowOverdraft] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setAmount('');
      setDescription('');
      setNotes('');
      setAllowOverdraft(false);
    }
  }, [open]);

  const amt = Number(amount) || 0;
  const after =
    mode === 'deposit'
      ? Number(account.currentBalance) + amt
      : Number(account.currentBalance) - amt;
  const willOverdraft = mode === 'withdraw' && after < 0;

  async function submit(e) {
    e.preventDefault();
    setSaving(true);
    try {
      if (mode === 'deposit') {
        await bankDeposit(account.id, {
          amount: amt,
          transactionDate: date,
          description: description || null,
          notes: notes || null,
        });
      } else {
        await bankWithdrawal(account.id, {
          amount: amt,
          transactionDate: date,
          description: description || null,
          notes: notes || null,
          allowOverdraft,
        });
      }
      toast.success(mode === 'deposit' ? 'Deposit recorded.' : 'Withdrawal recorded.');
      onDone?.();
      onClose?.();
    } catch (err) {
      toast.error(err?.message || 'Could not save the transaction.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <SlideOver
      open={open}
      onClose={onClose}
      title={
        mode === 'deposit'
          ? `Deposit to ${account.bankName}`
          : `Withdraw from ${account.bankName}`
      }
      width="md"
    >
      <form onSubmit={submit} className="space-y-3">
        <Input
          label="Amount (AED)"
          type="number"
          step="0.01"
          min="0"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          required
          autoFocus
        />
        <Input
          label="Date"
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
        />
        <Input
          label="Description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
        <Textarea
          label="Notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
        />
        {amt > 0 && (
          <div className="rounded-card bg-surface-2 px-4 py-3 text-sm flex justify-between">
            <span className="text-ink-muted">Resulting balance</span>
            <span
              className={`font-semibold ${
                after < 0 ? 'text-error' : 'text-ink'
              }`}
            >
              {formatCurrency(after)}
            </span>
          </div>
        )}
        {willOverdraft && (
          <div className="rounded-card border border-warning/30 bg-warning-light px-3 py-2 text-xs text-warning space-y-2">
            <p>
              This withdrawal will leave the account negative. Tick the box
              below to confirm manager approval.
            </p>
            <label className="inline-flex items-center gap-2">
              <input
                type="checkbox"
                checked={allowOverdraft}
                onChange={(e) => setAllowOverdraft(e.target.checked)}
              />
              Yes, allow overdraft
            </label>
          </div>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="submit"
            loading={saving}
            disabled={willOverdraft && !allowOverdraft}
          >
            {mode === 'deposit' ? 'Record deposit' : 'Record withdrawal'}
          </Button>
        </div>
      </form>
    </SlideOver>
  );
}

function HistorySlideOver({ account, open, onClose }) {
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!open || !account) return;
    setLoading(true);
    listBankTransactions(account.id, { limit: 50 })
      .then((res) => setTransactions(res?.data || []))
      .catch(() => setTransactions([]))
      .finally(() => setLoading(false));
  }, [open, account]);

  return (
    <SlideOver
      open={open}
      onClose={onClose}
      title={`${account?.bankName} — transactions`}
      width="lg"
    >
      {loading ? (
        <div className="text-sm text-ink-muted py-8 text-center">Loading…</div>
      ) : transactions.length === 0 ? (
        <EmptyState
          title="No transactions"
          description="This account has no activity yet."
        />
      ) : (
        <ul className="divide-y divide-border">
          {transactions.map((t) => (
            <li key={t.id} className="py-3 flex items-center gap-3">
              <div className="shrink-0">
                <CashTransactionTypeBadge type={t.transactionType} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm text-ink truncate">
                  {t.description || t.notes || '—'}
                </div>
                <div className="text-xs text-ink-muted">
                  {formatDateTime(t.timestamp)} · {t.employeeUsername || '—'}
                </div>
              </div>
              <div className="text-right">
                <TransactionDirectionBadge
                  direction={t.direction}
                  amount={t.amount}
                />
                <div className="text-[11px] text-ink-muted mt-1">
                  Balance {formatCurrency(t.balanceAfter)}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </SlideOver>
  );
}
