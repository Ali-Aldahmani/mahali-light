import { Banknote, CreditCard, Landmark } from 'lucide-react';
import { formatCurrency } from '../../utils/format.js';

const METHOD_META = {
  cash: { label: 'Cash', icon: Banknote, tone: 'text-success' },
  bank: { label: 'Bank transfer', icon: Landmark, tone: 'text-accent' },
  credit: { label: 'Store credit', icon: CreditCard, tone: 'text-warning' },
};

export default function RefundPreview({
  plan = [],
  total = 0,
  customerBalanceBefore = null,
  className = '',
}) {
  const planned = plan.reduce((acc, p) => acc + Number(p.amount || 0), 0);
  const remaining = Math.max(0, Math.round((total - planned) * 100) / 100);
  const creditDelta = plan
    .filter((p) => p.method === 'credit')
    .reduce((acc, p) => acc + Number(p.amount || 0), 0);

  return (
    <div className={`rounded-xl border border-border bg-surface p-4 ${className}`}>
      <div className="mb-3 flex items-baseline justify-between">
        <div>
          <div className="text-[11px] uppercase tracking-wide text-ink-muted">
            Refund preview
          </div>
          <div className="text-2xl font-semibold text-ink">
            {formatCurrency(total)}
          </div>
        </div>
        {remaining > 0 ? (
          <div className="text-xs font-medium text-error">
            {formatCurrency(remaining)} unallocated
          </div>
        ) : (
          <div className="text-xs font-medium text-success">
            Fully allocated
          </div>
        )}
      </div>

      <ul className="space-y-2">
        {plan.length === 0 && (
          <li className="rounded-lg bg-surface-2 p-3 text-sm text-ink-muted">
            No refund methods selected yet.
          </li>
        )}
        {plan.map((p, idx) => {
          const meta = METHOD_META[p.method] || METHOD_META.cash;
          const Icon = meta.icon;
          return (
            <li
              key={`${p.method}-${idx}`}
              className="flex items-center justify-between gap-2 rounded-lg bg-surface-2 px-3 py-2 text-sm"
            >
              <div className="flex items-center gap-2">
                <Icon className={`h-4 w-4 ${meta.tone}`} />
                <span className="font-medium text-ink">{meta.label}</span>
                {p.notes && (
                  <span className="text-xs text-ink-muted">— {p.notes}</span>
                )}
              </div>
              <span className="font-semibold text-ink">
                {formatCurrency(p.amount)}
              </span>
            </li>
          );
        })}
      </ul>

      {creditDelta > 0 && customerBalanceBefore != null && (
        <div className="mt-3 grid grid-cols-2 gap-3 rounded-lg bg-accent-light p-3 text-xs">
          <div>
            <div className="text-ink-muted">Customer credit before</div>
            <div className="font-semibold text-ink">
              {formatCurrency(customerBalanceBefore)}
            </div>
          </div>
          <div>
            <div className="text-ink-muted">After refund</div>
            <div className="font-semibold text-ink">
              {formatCurrency(Number(customerBalanceBefore) + creditDelta)}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
