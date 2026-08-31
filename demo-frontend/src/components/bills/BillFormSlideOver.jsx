import { useEffect, useState } from 'react';
import SlideOver from '../ui/SlideOver.jsx';
import Button from '../ui/Button.jsx';
import Input from '../ui/Input.jsx';
import Select from '../ui/Select.jsx';
import { createBill, updateBill } from '../../services/billService.js';
import { listCategories } from '../../services/expenseCategoryService.js';
import { listBankAccounts } from '../../services/bankAccountService.js';
import { toast } from '../../store/toastStore.js';

const FREQ_OPTIONS = [
  { value: 'monthly', label: 'Monthly' },
  { value: 'quarterly', label: 'Quarterly' },
  { value: 'yearly', label: 'Yearly' },
];
const METHOD_OPTIONS = [
  { value: 'bank', label: 'Bank' },
  { value: 'cash', label: 'Cash' },
];

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

// Returns the same day-of-month +N months, capping for short months (matches
// the server-side addCycle helper used in billService).
function addCycle(dateStr, frequency) {
  if (!dateStr) return '';
  const base = new Date(`${dateStr}T00:00:00`);
  const day = base.getDate();
  const target = new Date(base);
  if (frequency === 'monthly') target.setMonth(target.getMonth() + 1);
  else if (frequency === 'quarterly') target.setMonth(target.getMonth() + 3);
  else target.setFullYear(target.getFullYear() + 1);
  if (target.getDate() !== day) target.setDate(0);
  return target.toISOString().slice(0, 10);
}

export default function BillFormSlideOver({ open, onClose, bill = null, onSaved }) {
  const isEdit = !!bill?.id;
  const [name, setName] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [vendorName, setVendorName] = useState('');
  const [amount, setAmount] = useState('');
  const [isVariable, setIsVariable] = useState(false);
  const [frequency, setFrequency] = useState('monthly');
  const [startDate, setStartDate] = useState(todayIso());
  const [firstDueDate, setFirstDueDate] = useState(todayIso());
  const [firstDueTouched, setFirstDueTouched] = useState(false);
  const [reminderDaysBefore, setReminderDaysBefore] = useState(7);
  const [paymentMethod, setPaymentMethod] = useState('bank');
  const [bankAccountId, setBankAccountId] = useState('');
  const [autoRecurring, setAutoRecurring] = useState(true);
  const [notes, setNotes] = useState('');
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

    if (bill) {
      setName(bill.name || '');
      setCategoryId(bill.categoryId || '');
      setVendorName(bill.vendorName || '');
      setAmount(bill.amount != null ? String(bill.amount) : '');
      setIsVariable(!!bill.isVariableAmount);
      setFrequency(bill.frequency || 'monthly');
      setStartDate(bill.startDate || todayIso());
      setFirstDueDate(bill.nextDueDate || bill.startDate || todayIso());
      setReminderDaysBefore(bill.reminderDaysBefore ?? 7);
      setPaymentMethod(bill.paymentMethod || 'bank');
      setBankAccountId(bill.bankAccountId || '');
      setAutoRecurring(bill.autoRecurring !== false);
      setNotes(bill.notes || '');
      setFirstDueTouched(true);
    } else {
      const t = todayIso();
      setName('');
      setCategoryId('');
      setVendorName('');
      setAmount('');
      setIsVariable(false);
      setFrequency('monthly');
      setStartDate(t);
      setFirstDueDate(t);
      setFirstDueTouched(false);
      setReminderDaysBefore(7);
      setPaymentMethod('bank');
      setBankAccountId('');
      setAutoRecurring(true);
      setNotes('');
    }
    setError(null);
  }, [open, bill]);

  // Auto-fill first due date from start date until the user manually edits it.
  useEffect(() => {
    if (!open || firstDueTouched) return;
    setFirstDueDate(startDate);
  }, [startDate, firstDueTouched, open]);

  async function submit() {
    setError(null);
    if (!name.trim()) {
      setError('Name is required.');
      return;
    }
    if (!isVariable && (!amount || Number(amount) <= 0)) {
      setError('Amount is required for fixed-amount bills.');
      return;
    }
    if (paymentMethod === 'bank' && !bankAccountId) {
      setError('Pick a bank account or switch to cash.');
      return;
    }
    setBusy(true);
    try {
      const body = {
        name: name.trim(),
        categoryId: categoryId || null,
        vendorName: vendorName.trim() || null,
        amount: isVariable ? undefined : Number(amount),
        isVariableAmount: isVariable,
        frequency,
        startDate,
        firstDueDate,
        reminderDaysBefore: Number(reminderDaysBefore) || 7,
        paymentMethod,
        bankAccountId: paymentMethod === 'bank' ? bankAccountId : null,
        autoRecurring,
        notes: notes.trim() || null,
      };
      const saved = isEdit
        ? await updateBill(bill.id, {
            ...body,
            nextDueDate: firstDueDate,
          })
        : await createBill(body);
      toast.success(isEdit ? 'Bill updated.' : 'Bill added.');
      onSaved?.(saved);
      onClose();
    } catch (err) {
      setError(err?.message || 'Failed to save bill.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <SlideOver
      open={open}
      onClose={onClose}
      title={isEdit ? 'Edit bill' : 'Add new bill'}
      subtitle={isEdit ? bill?.name : undefined}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={submit} loading={busy}>
            {isEdit ? 'Save changes' : 'Add bill'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Input
          label="Bill name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          placeholder="DEWA Electricity"
        />
        <Select
          label="Category"
          value={categoryId}
          onChange={setCategoryId}
          options={categories}
          placeholder="Choose category"
        />
        <Input
          label="Vendor name"
          value={vendorName}
          onChange={(e) => setVendorName(e.target.value)}
          placeholder="DEWA / Etisalat / Landlord"
        />

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={isVariable}
            onChange={(e) => setIsVariable(e.target.checked)}
            className="h-4 w-4 rounded border-border text-accent focus:ring-accent"
          />
          Variable amount (enter actual at payment time)
        </label>

        {!isVariable && (
          <Input
            label="Expected amount (AED)"
            type="number"
            min="0"
            step="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            required
          />
        )}

        <Select
          label="Frequency"
          value={frequency}
          onChange={setFrequency}
          options={FREQ_OPTIONS}
          searchable={false}
          required
        />

        <div className="grid grid-cols-2 gap-3">
          <Input
            label="Start date"
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            required
          />
          <Input
            label="First due date"
            type="date"
            value={firstDueDate}
            onChange={(e) => {
              setFirstDueDate(e.target.value);
              setFirstDueTouched(true);
            }}
            required
          />
        </div>

        <Input
          label="Reminder days before"
          type="number"
          min="0"
          max="60"
          value={reminderDaysBefore}
          onChange={(e) => setReminderDaysBefore(e.target.value)}
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

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={autoRecurring}
            onChange={(e) => setAutoRecurring(e.target.checked)}
            className="h-4 w-4 rounded border-border text-accent focus:ring-accent"
          />
          Auto-create next cycle after payment
        </label>

        <div>
          <label className="mb-1.5 block text-sm font-medium">Notes</label>
          <textarea
            className="w-full rounded-input border border-border bg-surface p-3 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
            rows={3}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Reference number, account number, etc."
          />
        </div>

        {!isEdit && (
          <div className="rounded-input bg-surface-2 p-3 text-xs text-ink-muted">
            Next cycle will fall on{' '}
            <span className="font-medium text-ink">
              {addCycle(firstDueDate, frequency)}
            </span>{' '}
            ({frequency}).
          </div>
        )}

        {error && (
          <div className="rounded-input bg-error-light p-2 text-xs text-error">
            {error}
          </div>
        )}
      </div>
    </SlideOver>
  );
}
