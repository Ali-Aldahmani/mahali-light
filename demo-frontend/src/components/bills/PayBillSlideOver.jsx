import { useEffect, useState } from 'react';
import SlideOver from '../ui/SlideOver.jsx';
import Button from '../ui/Button.jsx';
import Input from '../ui/Input.jsx';
import Select from '../ui/Select.jsx';
import ReceiptUpload from '../ui/ReceiptUpload.jsx';
import BillPaymentStatusBadge from '../ui/BillPaymentStatusBadge.jsx';
import DaysUntilDueBadge from '../ui/DaysUntilDueBadge.jsx';
import { payBillPayment } from '../../services/billService.js';
import { listBankAccounts } from '../../services/bankAccountService.js';
import { toast } from '../../store/toastStore.js';

const METHOD_OPTIONS = [
  { value: 'bank', label: 'Bank' },
  { value: 'cash', label: 'Cash' },
];

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

// Slide-over for marking a bill_payment paid. Expects the parent to pass
// `payment` (already-shaped row) and an optional `bill` for context (used to
// pre-fill the payment method).
export default function PayBillSlideOver({
  open,
  onClose,
  payment,
  bill,
  onPaid,
}) {
  const [amount, setAmount] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('bank');
  const [bankAccountId, setBankAccountId] = useState('');
  const [paidDate, setPaidDate] = useState(todayIso());
  const [notes, setNotes] = useState('');
  const [receipt, setReceipt] = useState(null);
  const [banks, setBanks] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const isVariable = bill?.isVariableAmount || (payment && Number(payment.amountDue || 0) === 0);

  useEffect(() => {
    if (!open) return;
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

    const method = payment?.paymentMethod || bill?.paymentMethod || 'bank';
    setPaymentMethod(method);
    setBankAccountId(payment?.bankAccountId || bill?.bankAccountId || '');
    setPaidDate(todayIso());
    setNotes(payment?.notes || '');
    setReceipt(null);
    setAmount(
      isVariable
        ? ''
        : payment?.amountDue != null
        ? String(payment.amountDue)
        : '',
    );
    setError(null);
  }, [open, payment, bill, isVariable]);

  async function submit() {
    setError(null);
    if (!amount || Number(amount) <= 0) {
      setError('Enter the paid amount.');
      return;
    }
    if (paymentMethod === 'bank' && !bankAccountId) {
      setError('Pick a bank account or switch to cash.');
      return;
    }
    setBusy(true);
    try {
      const result = await payBillPayment(payment.id, {
        amountPaid: Number(amount),
        paymentMethod,
        bankAccountId: paymentMethod === 'bank' ? bankAccountId : null,
        paidDate,
        notes: notes.trim() || null,
        receipt,
      });
      toast.success(`${payment.billName || 'Bill'} marked paid.`);
      onPaid?.(result);
      onClose();
    } catch (err) {
      setError(err?.message || 'Failed to record payment.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <SlideOver
      open={open}
      onClose={onClose}
      title="Pay bill"
      subtitle={payment?.billName}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={submit} loading={busy}>
            Confirm payment
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="rounded-card border border-border bg-surface-2 p-3 text-sm">
          <div className="flex items-center justify-between">
            <div className="font-medium">{payment?.billName || '—'}</div>
            <BillPaymentStatusBadge status={payment?.status} />
          </div>
          <div className="mt-1 flex items-center justify-between text-xs text-ink-muted">
            <span>Due {payment?.dueDate || '—'}</span>
            <DaysUntilDueBadge days={payment?.daysUntilDue} />
          </div>
          <div className="mt-2 flex items-center justify-between">
            <span className="text-xs text-ink-muted">Amount due</span>
            <span className="font-semibold">
              {isVariable
                ? 'Variable'
                : `AED ${Number(payment?.amountDue || 0).toFixed(2)}`}
            </span>
          </div>
        </div>

        <Input
          label={`Amount paid (AED)${isVariable ? ' — variable bill' : ''}`}
          type="number"
          min="0"
          step="0.01"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          required
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

        <Input
          label="Paid date"
          type="date"
          value={paidDate}
          onChange={(e) => setPaidDate(e.target.value)}
        />

        <div>
          <label className="mb-1.5 block text-sm font-medium">Receipt (optional)</label>
          <ReceiptUpload
            onSelect={setReceipt}
            onClear={() => setReceipt(null)}
          />
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
