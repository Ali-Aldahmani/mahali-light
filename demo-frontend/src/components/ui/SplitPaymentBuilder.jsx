import { Banknote, Building2, CreditCard, Plus, Trash2 } from 'lucide-react';
import Button from './Button.jsx';
import Input from './Input.jsx';
import Money from './Money.jsx';
import ChangeCalculator from './ChangeCalculator.jsx';

const METHODS = [
  { value: 'cash', label: 'Cash', Icon: Banknote },
  { value: 'bank', label: 'Bank', Icon: Building2 },
  { value: 'credit', label: 'Credit', Icon: CreditCard },
];

// Multi-row payment composer used by the Confirm & Pay modal. Each row has a
// method picker and an amount input. Cash rows can be over-tendered and we
// show a "change due" callout; bank and credit rows are exact.
//
// Props:
//   payments        — array of { id, method, amount }
//   total           — invoice total to settle
//   customerLinked  — whether a customer is selected (gates credit)
//   onAdd(method)
//   onUpdate(id, patch)
//   onRemove(id)
export default function SplitPaymentBuilder({
  payments,
  total,
  customerLinked,
  onAdd,
  onUpdate,
  onRemove,
  hideCreditWhenGuest = true,
}) {
  const amountPaid = payments.reduce((s, p) => s + Number(p.amount || 0), 0);
  const remaining = Math.round((Number(total) - amountPaid) * 100) / 100;

  // For "change due", we only consider cash overpayment relative to remaining
  // before that row was applied. Simpler: use last cash row's amount and the
  // total. UX-wise it's good enough — the cashier knows what they tendered.
  const cashTendered = payments
    .filter((p) => p.method === 'cash')
    .reduce((s, p) => s + Number(p.amount || 0), 0);
  const overpaidCash = Math.max(0, cashTendered - Math.max(0, Number(total) - (amountPaid - cashTendered)));

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        {payments.length === 0 && (
          <div className="rounded-card border border-dashed border-border bg-surface-2 px-3 py-4 text-sm text-ink-muted text-center">
            No payments yet — add cash, bank, or credit below.
          </div>
        )}
        {payments.map((p) => (
          <PaymentRow
            key={p.id}
            payment={p}
            customerLinked={customerLinked}
            onUpdate={(patch) => onUpdate(p.id, patch)}
            onRemove={() => onRemove(p.id)}
          />
        ))}
      </div>

      <div className="grid grid-cols-3 gap-2">
        {METHODS.filter(
          (m) =>
            !(m.value === 'credit' && !customerLinked && hideCreditWhenGuest),
        ).map(({ value, label, Icon }) => (
          <Button
            key={value}
            variant="secondary"
            size="sm"
            leftIcon={<Plus className="h-3.5 w-3.5" />}
            onClick={() => onAdd(value, remaining > 0 ? remaining : 0)}
          >
            <span className="inline-flex items-center gap-1.5">
              <Icon className="h-3.5 w-3.5" />
              {label}
            </span>
          </Button>
        ))}
      </div>

      <div className="rounded-card border border-border bg-surface p-3 space-y-1.5">
        <div className="flex items-center justify-between text-sm">
          <span className="text-ink-muted">Total</span>
          <span className="text-ink font-medium"><Money value={total || 0} /></span>
        </div>
        <div className="flex items-center justify-between text-sm">
          <span className="text-ink-muted">Paid so far</span>
          <span className="text-ink font-medium"><Money value={amountPaid} /></span>
        </div>
        <div className="flex items-center justify-between text-sm">
          <span className="text-ink-muted">Remaining</span>
          <span
            className={[
              'font-semibold',
              remaining <= 0.001 ? 'text-success' : 'text-accent',
            ].join(' ')}
          >
            <Money value={Math.max(0, remaining)} />
          </span>
        </div>
      </div>

      <ChangeCalculator
        tendered={cashTendered}
        due={Math.max(0, Number(total) - (amountPaid - overpaidCash))}
      />
    </div>
  );
}

function PaymentRow({ payment, customerLinked, onUpdate, onRemove }) {
  const meta = METHODS.find((m) => m.value === payment.method) || METHODS[0];
  const Icon = meta.Icon;
  const isCredit = payment.method === 'credit';
  return (
    <div className="flex items-center gap-2 rounded-input border border-border bg-surface p-2">
      <div className="flex items-center gap-2 w-32 shrink-0">
        <Icon className="h-4 w-4 text-ink-muted" />
        <select
          value={payment.method}
          onChange={(e) => onUpdate({ method: e.target.value })}
          className="bg-transparent text-sm text-ink outline-none w-full"
        >
          {METHODS.map((m) => (
            <option key={m.value} value={m.value} disabled={m.value === 'credit' && !customerLinked}>
              {m.label}
            </option>
          ))}
        </select>
      </div>
      <div className="flex-1">
        <Input
          type="number"
          min={0}
          step="0.01"
          value={payment.amount}
          onChange={(e) => onUpdate({ amount: e.target.value })}
          placeholder="0.00"
        />
      </div>
      <button
        type="button"
        onClick={onRemove}
        className="inline-flex h-9 w-9 items-center justify-center rounded-input text-ink-muted hover:bg-surface-2 hover:text-error"
        aria-label="Remove payment"
      >
        <Trash2 className="h-4 w-4" />
      </button>
      {isCredit && !customerLinked && (
        <span className="text-xs text-error w-full pl-2">
          Select a customer to use credit.
        </span>
      )}
    </div>
  );
}
