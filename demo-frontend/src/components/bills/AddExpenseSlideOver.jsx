import { useEffect, useState } from 'react';
import SlideOver from '../ui/SlideOver.jsx';
import Button from '../ui/Button.jsx';
import Input from '../ui/Input.jsx';
import Select from '../ui/Select.jsx';
import ReceiptUpload from '../ui/ReceiptUpload.jsx';
import { createExpense } from '../../services/expenseService.js';
import { listCategories } from '../../services/expenseCategoryService.js';
import { listBankAccounts } from '../../services/bankAccountService.js';
import { toast } from '../../store/toastStore.js';

const METHOD_OPTIONS = [
  { value: 'cash', label: 'Cash' },
  { value: 'bank', label: 'Bank' },
];

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

export default function AddExpenseSlideOver({ open, onClose, onSaved }) {
  const [categoryId, setCategoryId] = useState('');
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [expenseDate, setExpenseDate] = useState(todayIso());
  const [paymentMethod, setPaymentMethod] = useState('cash');
  const [bankAccountId, setBankAccountId] = useState('');
  const [notes, setNotes] = useState('');
  const [receipt, setReceipt] = useState(null);
  const [categories, setCategories] = useState([]);
  const [banks, setBanks] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!open) return;
    listCategories()
      .then((c) =>
        setCategories(
          (c || [])
            .filter((x) => x.isActive !== false)
            .map((x) => ({ value: x.id, label: `${x.icon || ''} ${x.name}` })),
        ),
      )
      .catch(() => setCategories([]));
    listBankAccounts()
      .then((b) =>
        setBanks(
          (b || []).map((x) => ({
            value: x.id,
            label: `${x.bankName}${x.accountNumber ? ' · ' + x.accountNumber.slice(-4) : ''}`,
          })),
        ),
      )
      .catch(() => setBanks([]));

    setCategoryId('');
    setDescription('');
    setAmount('');
    setExpenseDate(todayIso());
    setPaymentMethod('cash');
    setBankAccountId('');
    setNotes('');
    setReceipt(null);
    setError(null);
  }, [open]);

  async function submit() {
    setError(null);
    if (!description.trim()) {
      setError('Description is required.');
      return;
    }
    if (!amount || Number(amount) <= 0) {
      setError('Amount must be greater than zero.');
      return;
    }
    if (paymentMethod === 'bank' && !bankAccountId) {
      setError('Pick a bank account or switch to cash.');
      return;
    }
    setBusy(true);
    try {
      const saved = await createExpense({
        categoryId: categoryId || null,
        description: description.trim(),
        amount: Number(amount),
        expenseDate,
        paymentMethod,
        bankAccountId: paymentMethod === 'bank' ? bankAccountId : null,
        notes: notes.trim() || null,
        receipt,
      });
      toast.success('Expense recorded.');
      onSaved?.(saved);
      onClose();
    } catch (err) {
      setError(err?.message || 'Failed to record expense.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <SlideOver
      open={open}
      onClose={onClose}
      title="Add one-time expense"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={submit} loading={busy}>
            Save expense
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Select
          label="Category"
          value={categoryId}
          onChange={setCategoryId}
          options={categories}
          placeholder="Choose category"
        />
        <Input
          label="Description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          required
          placeholder="What was bought?"
        />
        <Input
          label="Amount (AED)"
          type="number"
          min="0"
          step="0.01"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          required
        />
        <Input
          label="Date"
          type="date"
          value={expenseDate}
          onChange={(e) => setExpenseDate(e.target.value)}
        />
        <Select
          label="Payment method"
          value={paymentMethod}
          onChange={setPaymentMethod}
          options={METHOD_OPTIONS}
          searchable={false}
        />
        {paymentMethod === 'bank' && (
          <Select
            label="Bank account"
            value={bankAccountId}
            onChange={setBankAccountId}
            options={banks}
            placeholder="Pick a bank account"
            required
          />
        )}
        <div>
          <label className="mb-1.5 block text-sm font-medium">Receipt (optional)</label>
          <ReceiptUpload onSelect={setReceipt} onClear={() => setReceipt(null)} />
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium">Notes</label>
          <textarea
            className="w-full rounded-input border border-border bg-surface p-3 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
            rows={3}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>
        {error && (
          <div className="rounded-input bg-error-light p-2 text-xs text-error">
            {error}
          </div>
        )}
      </div>
    </SlideOver>
  );
}
