'use client';

import { useEffect, useState } from 'react';
import { Banknote, Building2, FileSpreadsheet, Upload } from 'lucide-react';
import SlideOver from '@/components/ui/SlideOver';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import { toast } from '@/store/toastStore';
import { addPoPayment, uploadPaymentReceipt } from '@/services/supplierPaymentService';
import { formatCurrency, storeDate } from '@/lib/utils/format';
import type { PurchaseOrder } from './types';
import DateField from '@/components/ui/DateField';

const METHODS = [
  { value: 'cash', label: 'Cash', Icon: Banknote },
  { value: 'bank_transfer', label: 'Bank transfer', Icon: Building2 },
  { value: 'cheque', label: 'Cheque', Icon: FileSpreadsheet },
];

function money2(n: number) {
  return Math.round(n * 100) / 100;
}

function todayISO() {
  return storeDate();
}

interface AddPaymentSlideOverProps {
  open: boolean;
  onClose: () => void;
  po: PurchaseOrder | null;
  onAdded?: (created: any) => void;
}

export default function AddPaymentSlideOver({
  open,
  onClose,
  po,
  onAdded,
}: AddPaymentSlideOverProps) {
  const balance = Number(po?.balanceDue || 0);
  const [amount, setAmount] = useState<number | string>(balance);
  const [payKind, setPayKind] = useState<'full' | 'half' | 'custom'>('full');
  const [method, setMethod] = useState('cash');
  const [date, setDate] = useState(todayISO());
  const [notes, setNotes] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (open) {
      setAmount(balance);
      setPayKind('full');
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
      const created = await addPoPayment(po!.id, {
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
    } catch (err: any) {
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
      subtitle={po ? `PO ${po.poNumber} · Balance ${formatCurrency(balance)}` : ''}
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
        <div>
          <label className="text-sm font-medium text-ink mb-1.5 block">How much to pay</label>
          <div className="grid grid-cols-3 gap-2">
            {(
              [
                { id: 'full', label: 'Paid in full', amount: money2(balance) },
                { id: 'half', label: 'Half', amount: money2(balance / 2) },
                { id: 'custom', label: 'Specific amount', amount: null },
              ] as const
            ).map((opt) => {
              const active = payKind === opt.id;
              return (
                <button
                  type="button"
                  key={opt.id}
                  onClick={() => {
                    setPayKind(opt.id);
                    if (opt.amount != null) setAmount(opt.amount);
                  }}
                  className={[
                    'rounded-input border px-2 py-2 text-sm text-center transition',
                    active
                      ? 'border-accent bg-accent-light text-accent'
                      : 'border-border bg-surface text-ink hover:bg-surface-2',
                  ].join(' ')}
                >
                  <div className="font-medium">{opt.label}</div>
                  {opt.amount != null && (
                    <div className="text-xs mt-0.5 opacity-80">{formatCurrency(opt.amount)}</div>
                  )}
                </button>
              );
            })}
          </div>
        </div>
        <Input
          label="Amount"
          type="number"
          step="0.01"
          min={0}
          max={balance}
          value={amount}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
            setPayKind('custom');
            setAmount(e.target.value);
          }}
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

        <DateField label="Payment date" value={date} onChange={setDate} required />

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
