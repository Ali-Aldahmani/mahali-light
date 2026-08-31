import Button from './Button.jsx';
import DaysUntilDueBadge from './DaysUntilDueBadge.jsx';
import BillPaymentStatusBadge from './BillPaymentStatusBadge.jsx';

// Card rendered inside "Bills requiring attention" panels (the main expenses
// page and the dashboard widget). `bill` is a shaped bill_payment with
// {billName, vendorName, amountDue, daysUntilDue, status, categoryIcon}.
export default function BillCard({ bill, onPay, compact = false }) {
  if (!bill) return null;
  const amt = Number(bill.amountDue || 0);
  return (
    <div
      className={`flex items-center justify-between rounded-card border border-border bg-surface ${
        compact ? 'p-3' : 'p-4'
      } shadow-soft`}
    >
      <div className="flex items-center gap-3 min-w-0">
        <span className="text-2xl shrink-0" aria-hidden>
          {bill.categoryIcon || '💸'}
        </span>
        <div className="min-w-0">
          <div className="truncate font-medium text-ink">
            {bill.billName || '—'}
          </div>
          <div className="flex items-center gap-2 text-xs text-ink-muted">
            <span className="truncate">{bill.vendorName || ''}</span>
            <BillPaymentStatusBadge status={bill.status} />
            <DaysUntilDueBadge days={bill.daysUntilDue} />
          </div>
        </div>
      </div>
      <div className="flex items-center gap-3 shrink-0">
        <div className="text-right">
          <div className="text-sm font-semibold">
            {amt > 0 ? `AED ${amt.toFixed(2)}` : 'Variable'}
          </div>
          <div className="text-[11px] text-ink-muted">{bill.dueDate}</div>
        </div>
        {onPay && (
          <Button size="sm" variant="primary" onClick={() => onPay(bill)}>
            Pay Now
          </Button>
        )}
      </div>
    </div>
  );
}
