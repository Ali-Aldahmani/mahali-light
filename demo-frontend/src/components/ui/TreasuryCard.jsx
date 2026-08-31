import { formatCurrency } from '../../utils/format.js';
import { cn } from '../../utils/cn.js';

// Compact treasury summary card. Used in a grid on the Overview tab and the
// header of the cash drawer / bank tabs.
//   tone: 'cash' | 'bank' | 'receivables' | 'payables' | 'accent' | 'neutral'
export default function TreasuryCard({
  label,
  value,
  hint = null,
  Icon = null,
  tone = 'neutral',
  className = '',
  onClick = null,
}) {
  const toneCls = {
    cash: 'bg-success-light text-success',
    bank: 'bg-accent-light text-accent',
    receivables: 'bg-warning-light text-warning',
    payables: 'bg-error-light text-error',
    accent: 'bg-accent-light text-accent',
    neutral: 'bg-surface-2 text-ink',
  }[tone];

  return (
    <div
      className={cn(
        'rounded-card border border-border bg-surface p-4',
        onClick && 'cursor-pointer hover:shadow',
        className,
      )}
      onClick={onClick}
    >
      <div className="flex items-center justify-between">
        <div>
          <div className="text-xs text-ink-muted">{label}</div>
          <div className="text-xl font-semibold text-ink mt-1">
            {typeof value === 'number' ? formatCurrency(value) : value}
          </div>
          {hint && (
            <div className="text-xs text-ink-muted mt-1">{hint}</div>
          )}
        </div>
        {Icon && (
          <div
            className={cn(
              'h-10 w-10 inline-flex items-center justify-center rounded-md',
              toneCls,
            )}
          >
            <Icon className="h-5 w-5" />
          </div>
        )}
      </div>
    </div>
  );
}
