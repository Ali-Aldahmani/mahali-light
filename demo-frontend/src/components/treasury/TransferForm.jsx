import { useMemo, useState } from 'react';
import { ArrowRight } from 'lucide-react';
import Button from '../ui/Button.jsx';
import Input from '../ui/Input.jsx';
import Select from '../ui/Select.jsx';
import Textarea from '../ui/Textarea.jsx';
import { formatCurrency } from '../../utils/format.js';

// Reusable transfer form. Source/destination are chosen from the union of the
// cash drawer + every active bank account. The caller wires `onSubmit` to the
// matching API (cash → bank uses the cash route, bank → * uses the bank
// route).
export default function TransferForm({
  drawer = null,
  banks = [],
  defaultFrom = null,
  onSubmit,
  loading = false,
}) {
  const sources = useMemo(() => {
    const list = [];
    if (drawer)
      list.push({
        type: 'cash_drawer',
        id: drawer.id || 'cash',
        label: `Cash drawer · ${formatCurrency(drawer.balance || 0)}`,
        balance: Number(drawer.balance || 0),
      });
    for (const b of banks) {
      list.push({
        type: 'bank_account',
        id: b.id,
        label: `${b.bankName} (${b.accountName}) · ${formatCurrency(b.currentBalance || 0)}`,
        balance: Number(b.currentBalance || 0),
      });
    }
    return list;
  }, [drawer, banks]);

  const initial = useMemo(() => {
    if (defaultFrom) return defaultFrom;
    return sources[0]?.id || '';
  }, [defaultFrom, sources]);

  const [fromKey, setFromKey] = useState(initial);
  const [toKey, setToKey] = useState(sources[1]?.id || '');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');

  const from = sources.find((s) => s.id === fromKey);
  const to = sources.find((s) => s.id === toKey);
  const amt = Number(amount) || 0;
  const overdraft = from && from.type === 'cash_drawer' && amt > from.balance;
  const bankOverdraft = from && from.type === 'bank_account' && amt > from.balance;

  async function submit(e) {
    e.preventDefault();
    setError('');
    if (!from || !to) return setError('Select both source and destination.');
    if (from.id === to.id)
      return setError('Source and destination must be different.');
    if (!Number.isFinite(amt) || amt <= 0)
      return setError('Amount must be greater than zero.');
    if (overdraft) return setError('Cash drawer cannot go negative.');

    try {
      await onSubmit?.({
        from,
        to,
        amount: amt,
        transferDate: date,
        notes: notes || null,
        allowOverdraft: bankOverdraft,
      });
      setAmount('');
      setNotes('');
    } catch (err) {
      setError(err?.message || 'Transfer failed.');
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_1fr] items-end gap-3">
        <Select
          label="From"
          value={fromKey}
          options={sources.map((s) => ({ value: s.id, label: s.label }))}
          onChange={(v) => setFromKey(v)}
          placeholder="Select source"
        />
        <div className="hidden md:flex items-center justify-center text-ink-muted pb-2">
          <ArrowRight className="h-5 w-5" />
        </div>
        <Select
          label="To"
          value={toKey}
          options={sources
            .filter((s) => s.id !== fromKey)
            .map((s) => ({ value: s.id, label: s.label }))}
          onChange={(v) => setToKey(v)}
          placeholder="Select destination"
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Input
          label="Amount (AED)"
          type="number"
          step="0.01"
          min="0"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          required
        />
        <Input
          label="Date"
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
        />
      </div>

      <Textarea
        label="Notes"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        rows={2}
      />

      {bankOverdraft && (
        <p className="text-xs text-warning bg-warning-light rounded-card border border-warning/30 px-3 py-2">
          This will leave the source bank balance negative. Proceed only with
          manager approval.
        </p>
      )}
      {error && <p className="text-sm text-error">{error}</p>}

      <div className="flex justify-end">
        <Button type="submit" loading={loading}>
          Transfer
        </Button>
      </div>
    </form>
  );
}
