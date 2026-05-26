import { useEffect, useState } from 'react';
import { Banknote, Building2 } from 'lucide-react';
import SlideOver from '../../components/ui/SlideOver.jsx';
import Button from '../../components/ui/Button.jsx';
import Input from '../../components/ui/Input.jsx';
import { toast } from '../../store/toastStore.js';
import { collectPayment } from '../../services/customerPaymentService.js';
import { formatCurrency } from '../../utils/format.js';

const METHODS = [
  { value: 'cash', label: 'Cash', Icon: Banknote },
  { value: 'bank_transfer', label: 'Bank transfer', Icon: Building2 },
];

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

export default function CollectPaymentSlideOver({
  open,
  onClose,
  customer,
  onCollected,
}) {
  const balance = Number(customer?.creditBalance || 0);
  const [amount, setAmount] = useState(balance);
  const [method, setMethod] = useState('cash');
  const [date, setDate] = useState(todayISO());
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState({});

  useEffect(() => {
    if (open) {
      setAmount(balance);
      setMethod('cash');
      setDate(todayISO());
      setNotes('');
      setErrors({});
    }
  }, [open, balance]);

  const amt = Number(amount) || 0;
  const after = Math.max(0, balance - amt);

  async function submit() {
    if (!Number.isFinite(amt) || amt <= 0) {
      setErrors({ amount: 'Enter an amount greater than zero.' });
      return;
    }
    if (amt - balance > 0.001) {
      setErrors({
        amount: `Amount cannot exceed the balance of ${formatCurrency(balance)}.`,
      });
      return;
    }
    setSaving(true);
    try {
      const result = await collectPayment(customer.id, {
        amount: amt,
        paymentMethod: method,
        paymentDate: date,
        notes: notes || null,
      });
      toast.success('Payment recorded.');
      onCollected?.(result);
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
      title="Collect payment"
      subtitle={
        customer
          ? `${customer.name} · current balance ${formatCurrency(balance)}`
          : ''
      }
      width="md"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button
            onClick={submit}
            loading={saving}
            disabled={balance <= 0.001}
          >
            Record payment
          </Button>
        </>
      }
    >
      {balance <= 0.001 ? (
        <div className="rounded-card border border-border bg-success-light p-4 text-success text-sm">
          This customer has no outstanding balance.
        </div>
      ) : (
        <div className="space-y-4">
          <div className="rounded-card border border-border bg-surface-2 p-4 flex items-center justify-between">
            <div>
              <div className="text-xs text-ink-muted">Current balance</div>
              <div className="text-base font-semibold text-ink">
                {formatCurrency(balance)}
              </div>
            </div>
            <div className="text-right">
              <div className="text-xs text-ink-muted">After this payment</div>
              <div
                className={[
                  'text-base font-semibold',
                  after <= 0.001 ? 'text-success' : 'text-accent',
                ].join(' ')}
              >
                {formatCurrency(after)}
              </div>
            </div>
          </div>

          <Input
            label="Amount (AED)"
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
            <div className="grid grid-cols-2 gap-2">
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
              Notes
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              className="w-full rounded-input border border-border bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-muted focus:border-accent focus:ring-2 focus:ring-accent/20 focus:outline-none"
              placeholder="Reference, cheque number, etc."
            />
          </div>
        </div>
      )}
    </SlideOver>
  );
}
