import { useEffect, useState } from 'react';
import { Banknote, Building2, FileSpreadsheet, Upload } from 'lucide-react';
import SlideOver from '../../components/ui/SlideOver.jsx';
import Button from '../../components/ui/Button.jsx';
import Input from '../../components/ui/Input.jsx';
import { toast } from '../../store/toastStore.js';
import {
  addPoPayment,
  uploadPaymentReceipt,
} from '../../services/supplierPaymentService.js';
import { formatCurrency } from '../../utils/format.js';

const METHODS = [
  { value: 'cash', label: 'Cash', Icon: Banknote },
  { value: 'bank_transfer', label: 'Bank transfer', Icon: Building2 },
  { value: 'cheque', label: 'Cheque', Icon: FileSpreadsheet },
];

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

export default function AddPaymentSlideOver({ open, onClose, po, onAdded }) {
  const balance = Number(po?.balanceDue || 0);
  const [amount, setAmount] = useState(balance);
  const [method, setMethod] = useState('cash');
  const [date, setDate] = useState(todayISO());
  const [notes, setNotes] = useState('');
  const [file, setFile] = useState(null);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState({});

  useEffect(() => {
    if (open) {
      setAmount(balance);
      setMethod('cash');
      setDate(todayISO());
      setNotes('');
      setFile(null);
      setErrors({});
    }
  }, [open, balance]);

  async function submit() {
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt <= 0) {
      setErrors({ amount: 'Enter an amount greater than zero.' });
      return;
    }
    if (amt > balance + 0.001) {
      setErrors({
        amount: `Amount cannot exceed the outstanding balance of ${formatCurrency(balance)}.`,
      });
      return;
    }
    setSaving(true);
    try {
      const created = await addPoPayment(po.id, {
        amount: amt,
        paymentMethod: method,
        paymentDate: date,
        notes: notes || null,
      });
      if (file && created?.payment?.id) {
        try {
          await uploadPaymentReceipt(created.payment.id, file);
        } catch (e) {
          toast.warning('Payment recorded but receipt upload failed.');
        }
      }
      toast.success('Payment recorded.');
      onAdded?.(created);
      onClose?.();
    } catch (err) {
      if (err?.code === 'BIZ_PAYMENT_EXCEEDS_BALANCE') {
        setErrors({ amount: err.message });
      }
      toast.error(err?.message || 'Failed to record payment.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <SlideOver
      open={open}
      onClose={onClose}
      title="Add payment"
      subtitle={
        po ? `PO ${po.poNumber} · Balance ${formatCurrency(balance)}` : ''
      }
      width="md"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={submit} loading={saving}>
            Record payment
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Input
          label="Amount"
          type="number"
          step="0.01"
          min={0}
          max={balance}
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          error={errors.amount}
          required
        />

        <div>
          <label className="text-sm font-medium text-ink mb-1.5 block">
            Payment method
          </label>
          <div className="grid grid-cols-3 gap-2">
            {METHODS.map(({ value, label, Icon }) => {
              const active = method === value;
              return (
                <button
                  type="button"
                  key={value}
                  onClick={() => setMethod(value)}
                  className={[
                    'rounded-input border px-3 py-2 text-sm flex flex-col items-center gap-1.5 transition',
                    active
                      ? 'border-accent bg-accent-light text-accent'
                      : 'border-border bg-surface text-ink hover:bg-surface-2',
                  ].join(' ')}
                >
                  <Icon size={18} />
                  <span>{label}</span>
                </button>
              );
            })}
          </div>
        </div>

        <Input
          label="Payment date"
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          required
        />

        <div>
          <label className="text-sm font-medium text-ink mb-1.5 block">
            Receipt (optional)
          </label>
          <label className="flex items-center gap-3 rounded-input border border-dashed border-border bg-surface-2 px-3 py-3 cursor-pointer hover:bg-surface">
            <Upload size={16} className="text-ink-muted" />
            <span className="text-sm text-ink-muted truncate">
              {file ? file.name : 'Upload PDF or image'}
            </span>
            <input
              type="file"
              className="hidden"
              accept="application/pdf,image/*"
              onChange={(e) => setFile(e.target.files?.[0] || null)}
            />
          </label>
        </div>

        <div>
          <label className="text-sm font-medium text-ink mb-1.5 block">Notes</label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            className="w-full rounded-input border border-border bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-muted focus:border-accent focus:ring-2 focus:ring-accent/20 focus:outline-none"
            placeholder="Reference number, cheque #, etc."
          />
        </div>
      </div>
    </SlideOver>
  );
}
