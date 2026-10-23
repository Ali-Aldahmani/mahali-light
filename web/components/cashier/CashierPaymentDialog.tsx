'use client';

import { useEffect, useMemo, useRef } from 'react';
import { Banknote, Building2, CreditCard, Trash2 } from 'lucide-react';
import Modal from '@/components/ui/Modal';
import Button from '@/components/ui/Button';
import { formatCurrency } from '@/lib/utils/format';
import { cn } from '@/lib/utils/cn';
import Select from '@/components/ui/Select';

const METHODS = [
  { value: 'cash', label: 'Cash', Icon: Banknote },
  { value: 'bank', label: 'Card / Bank', Icon: Building2 },
  { value: 'credit', label: 'Customer credit', Icon: CreditCard },
] as const;

const cents = (n: unknown) => Math.round((Number(n) || 0) * 100);

// Round-up tender suggestions for cash (e.g. 127.50 → 130, 150, 200).
export function cashSuggestions(total: number): number[] {
  const t = Number(total) || 0;
  if (t <= 0) return [];
  const out = new Set<number>();
  for (const step of [5, 10, 50, 100, 500]) {
    const v = Math.ceil(t / step) * step;
    if (v > t + 0.001) out.add(v);
  }
  return [...out].sort((a, b) => a - b).slice(0, 4);
}

// Touch-first payment step over the existing posStore payment rows and the
// shared checkout. The server recomputes the total and validates every
// allocation; this dialog only captures the tender split.
export default function CashierPaymentDialog({
  open,
  total,
  customer,
  payments,
  submitting,
  error,
  onAdd,
  onUpdate,
  onRemove,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  total: number;
  customer: any | null;
  payments: { id: string; method: string; amount: number }[];
  submitting: boolean;
  error: string | null;
  onAdd: (method: string, amount: number) => void;
  onUpdate: (id: string, patch: { method?: string; amount?: number }) => void;
  onRemove: (id: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const confirmRef = useRef<HTMLButtonElement>(null);
  const registered = !!customer?.id;

  const summary = useMemo(() => {
    const paid = payments.reduce((s, p) => s + cents(p.amount), 0);
    const nonCash = payments.filter((p) => p.method !== 'cash').reduce((s, p) => s + cents(p.amount), 0);
    const cash = paid - nonCash;
    const due = cents(total);
    const change = Math.max(0, cash - Math.max(0, due - nonCash));
    const remaining = Math.max(0, due - paid);
    return { paid: paid / 100, change: change / 100, remaining: remaining / 100 };
  }, [payments, total]);

  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => confirmRef.current?.focus(), 30);
    return () => clearTimeout(t);
  }, [open]);

  const firstCash = payments.find((p) => p.method === 'cash');
  const setCashTender = (amount: number) => {
    if (firstCash) onUpdate(firstCash.id, { amount });
    else onAdd('cash', amount);
  };
  const addMethod = (method: string) => {
    const remaining = Math.max(0, summary.remaining);
    onAdd(method, remaining > 0 ? remaining : 0);
  };

  const guestBalance = !registered && summary.remaining > 0.001;
  const blocked = guestBalance || total <= 0;

  return (
    <Modal
      open={open}
      onClose={submitting ? undefined : onCancel}
      title="Take payment"
      subtitle={registered ? `Customer: ${customer.name}` : 'Guest sale — must be paid in full'}
      size="lg"
      footer={
        <>
          <Button variant="secondary" size="touch" onClick={onCancel} disabled={submitting}>
            Back to sale
          </Button>
          <Button
            ref={confirmRef}
            size="touch"
            onClick={onConfirm}
            loading={submitting}
            disabled={blocked}
            className="min-w-[12rem] bg-success hover:bg-green-700 disabled:bg-success/40"
          >
            Complete sale · {formatCurrency(total)}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="flex items-end justify-between rounded-card bg-surface-2 px-4 py-3">
          <span className="text-sm text-ink-muted">Total due</span>
          <span className="text-3xl font-bold text-ink">{formatCurrency(total)}</span>
        </div>

        <div>
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-ink-muted">Quick cash</p>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
            <TenderButton label="Exact" onClick={() => setCashTender(total)} />
            {cashSuggestions(total).map((v) => (
              <TenderButton key={v} label={formatCurrency(v)} onClick={() => setCashTender(v)} />
            ))}
          </div>
        </div>

        <ul className="space-y-2" aria-label="Payments">
          {payments.length === 0 && (
            <li className="rounded-card border border-dashed border-border px-3 py-4 text-center text-sm text-ink-muted">
              Add a payment method below.
            </li>
          )}
          {payments.map((p) => {
            const meta = METHODS.find((m) => m.value === p.method) || METHODS[0];
            return (
              <li key={p.id} className="flex items-center gap-2">
                <Select
                  containerClassName="w-40 shrink-0"
                  className="h-12"
                  placeholder="Payment method"
                  value={p.method}
                  onChange={(v) => onUpdate(p.id, { method: v })}
                  options={METHODS.filter((m) => m.value !== 'credit' || registered).map((m) => ({ value: m.value, label: m.label }))}
                />
                <label className="relative flex-1">
                  <span className="sr-only">{meta.label} amount</span>
                  <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-ink-muted">AED</span>
                  <input
                    type="number"
                    inputMode="decimal"
                    min={0}
                    step="0.01"
                    value={p.amount || ''}
                    onChange={(e) => onUpdate(p.id, { amount: Math.max(0, Number(e.target.value) || 0) })}
                    className="h-12 w-full rounded-input border border-border pl-12 pr-3 text-right text-lg text-ink focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30"
                  />
                </label>
                <button
                  type="button"
                  onClick={() => onRemove(p.id)}
                  className="inline-flex h-12 w-12 items-center justify-center rounded-input text-ink-muted hover:bg-error-light hover:text-error focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-error"
                  aria-label={`Remove ${meta.label} payment`}
                >
                  <Trash2 className="h-5 w-5" />
                </button>
              </li>
            );
          })}
        </ul>

        <div className="grid grid-cols-3 gap-2">
          {METHODS.map(({ value, label, Icon }) => {
            const disabled = value === 'credit' && !registered;
            return (
              <button
                key={value}
                type="button"
                disabled={disabled}
                onClick={() => addMethod(value)}
                title={disabled ? 'Select a registered customer to use credit' : undefined}
                className="flex h-12 items-center justify-center gap-2 rounded-input border border-border bg-surface text-sm font-medium text-ink touch-manipulation hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-40"
              >
                <Icon className="h-4 w-4" aria-hidden />+ {label}
              </button>
            );
          })}
        </div>

        <dl className="grid grid-cols-3 gap-2 text-center">
          <Stat label="Paid" value={formatCurrency(summary.paid)} />
          <Stat
            label={registered ? 'On account' : 'Remaining'}
            value={formatCurrency(summary.remaining)}
            tone={summary.remaining > 0 ? (registered ? 'warning' : 'error') : 'default'}
          />
          <Stat label="Change" value={formatCurrency(summary.change)} tone={summary.change > 0 ? 'success' : 'default'} />
        </dl>

        {guestBalance && (
          <p role="alert" className="text-sm font-medium text-error">
            Guest sales must be paid in full. Add payment or select a customer.
          </p>
        )}
        {error && (
          <p role="alert" className="rounded-input bg-error-light px-3 py-2 text-sm font-medium text-error">
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
}

function TenderButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="h-12 rounded-input border border-border bg-surface text-sm font-semibold text-ink touch-manipulation hover:border-accent hover:bg-accent-light focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
    >
      {label}
    </button>
  );
}

function Stat({ label, value, tone = 'default' }: { label: string; value: string; tone?: 'default' | 'success' | 'warning' | 'error' }) {
  return (
    <div className="rounded-input bg-surface-2 px-2 py-2">
      <dt className="text-[11px] text-ink-muted">{label}</dt>
      <dd
        className={cn(
          'text-sm font-semibold',
          tone === 'success' && 'text-success',
          tone === 'warning' && 'text-warning',
          tone === 'error' && 'text-error',
          tone === 'default' && 'text-ink',
        )}
      >
        {value}
      </dd>
    </div>
  );
}
