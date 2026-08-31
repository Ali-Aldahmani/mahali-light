import { useEffect, useState } from 'react';
import { Trash2, Plus, CheckCircle2, AlertCircle } from 'lucide-react';
import SlideOver from '../../components/ui/SlideOver.jsx';
import Button from '../../components/ui/Button.jsx';
import Input from '../../components/ui/Input.jsx';
import AccountSelector from '../../components/ui/AccountSelector.jsx';
import { cn } from '../../utils/cn.js';
import {
  listAccounts,
  postManualJournalEntry,
} from '../../services/financeService.js';
import { toast } from '../../store/toastStore.js';

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function emptyLine() {
  return { id: Math.random(), accountId: '', side: 'debit', amount: '' };
}

// Manual journal entry slide-over. Lines render as accountId + side toggle +
// amount. Running balance check is shown in the footer, and the submit button
// is disabled until debits exactly match credits.
export default function ManualJournalEntrySlideOver({ open, onClose, onPosted }) {
  const [date, setDate] = useState(todayIso());
  const [description, setDescription] = useState('');
  const [lines, setLines] = useState([emptyLine(), emptyLine()]);
  const [accounts, setAccounts] = useState([]);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    listAccounts()
      .then(setAccounts)
      .catch((err) => toast.error(err?.message || 'Could not load accounts.'));
  }, [open]);

  useEffect(() => {
    if (open) {
      setDate(todayIso());
      setDescription('');
      setLines([emptyLine(), emptyLine()]);
    }
  }, [open]);

  function updateLine(id, patch) {
    setLines((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  }

  function removeLine(id) {
    setLines((prev) => (prev.length > 2 ? prev.filter((l) => l.id !== id) : prev));
  }

  const totals = lines.reduce(
    (acc, l) => {
      const amt = Number(l.amount) || 0;
      if (l.side === 'debit') acc.debit += amt;
      else acc.credit += amt;
      return acc;
    },
    { debit: 0, credit: 0 },
  );
  const balanced = Math.abs(totals.debit - totals.credit) < 0.01 && totals.debit > 0;
  const valid =
    balanced &&
    description.trim().length >= 3 &&
    lines.every((l) => l.accountId && Number(l.amount) > 0);

  async function submit() {
    if (!valid) return;
    setSubmitting(true);
    try {
      await postManualJournalEntry({
        date,
        description: description.trim(),
        lines: lines.map((l) => ({
          accountId: l.accountId,
          debit: l.side === 'debit' ? Number(l.amount) : 0,
          credit: l.side === 'credit' ? Number(l.amount) : 0,
        })),
      });
      toast.success('Journal entry posted.');
      onPosted?.();
    } catch (err) {
      toast.error(err?.message || 'Could not post entry.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <SlideOver
      open={open}
      onClose={onClose}
      title="Manual journal entry"
      subtitle="Debits must equal credits before posting."
      width="lg"
      footer={
        <div className="flex items-center justify-between w-full">
          <div
            className={cn(
              'inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs',
              balanced
                ? 'bg-success-light text-success'
                : 'bg-warning-light text-warning',
            )}
          >
            {balanced ? (
              <CheckCircle2 className="h-3.5 w-3.5" />
            ) : (
              <AlertCircle className="h-3.5 w-3.5" />
            )}
            Δ {(totals.debit - totals.credit).toFixed(2)}
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button onClick={submit} loading={submitting} disabled={!valid}>
              Post entry
            </Button>
          </div>
        </div>
      }
    >
      <div className="space-y-4">
        <div>
          <label className="text-xs uppercase tracking-wide text-ink-muted">Date</label>
          <Input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </div>
        <div>
          <label className="text-xs uppercase tracking-wide text-ink-muted">
            Description
          </label>
          <Input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="e.g. Owner capital injection"
          />
        </div>

        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-semibold text-ink">Lines</span>
            <Button
              variant="secondary"
              size="sm"
              leftIcon={<Plus size={14} />}
              onClick={() => setLines((prev) => [...prev, emptyLine()])}
            >
              Add line
            </Button>
          </div>
          <div className="space-y-2">
            {lines.map((l) => (
              <div key={l.id} className="rounded-md border border-border p-2 space-y-2">
                <AccountSelector
                  accounts={accounts}
                  value={l.accountId}
                  onChange={(id) => updateLine(l.id, { accountId: id })}
                  placeholder="Account…"
                />
                <div className="flex gap-2">
                  <div className="flex rounded-md border border-border overflow-hidden">
                    <button
                      type="button"
                      className={cn(
                        'px-3 text-xs',
                        l.side === 'debit'
                          ? 'bg-accent text-white'
                          : 'bg-surface text-ink hover:bg-surface-2',
                      )}
                      onClick={() => updateLine(l.id, { side: 'debit' })}
                    >
                      Debit
                    </button>
                    <button
                      type="button"
                      className={cn(
                        'px-3 text-xs',
                        l.side === 'credit'
                          ? 'bg-accent text-white'
                          : 'bg-surface text-ink hover:bg-surface-2',
                      )}
                      onClick={() => updateLine(l.id, { side: 'credit' })}
                    >
                      Credit
                    </button>
                  </div>
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    value={l.amount}
                    onChange={(e) => updateLine(l.id, { amount: e.target.value })}
                    className="flex-1"
                    placeholder="0.00"
                  />
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => removeLine(l.id)}
                    disabled={lines.length <= 2}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-3 rounded-md bg-surface-2 p-2 text-xs font-mono flex justify-between">
            <span>Debits: {totals.debit.toFixed(2)}</span>
            <span>Credits: {totals.credit.toFixed(2)}</span>
          </div>
        </div>
      </div>
    </SlideOver>
  );
}
