import { Calendar } from 'lucide-react';
import { cn } from '../../utils/cn.js';
import { formatCurrency, formatDate } from '../../utils/format.js';

// UAE-FTA-style summary: output vs input tax with the net payable and a due
// date countdown. TRN comes from store settings — caller passes it in.
export default function VATSummaryCard({ data, trn = null, className = '' }) {
  if (!data) return null;
  const dueDate = data.dueDate ? new Date(`${data.dueDate}T00:00:00`) : null;
  const daysLeft = dueDate
    ? Math.max(0, Math.floor((dueDate - new Date()) / (1000 * 60 * 60 * 24)))
    : null;
  return (
    <div className={cn('rounded-card border border-border bg-surface overflow-hidden', className)}>
      <div className="px-4 py-3 border-b border-border flex items-center justify-between">
        <div>
          <div className="text-sm font-semibold text-ink">VAT Return</div>
          <div className="text-xs text-ink-muted">
            {formatDate(data.startDate)} – {formatDate(data.endDate)}
            {trn && <span className="ml-2">· TRN: {trn}</span>}
          </div>
        </div>
        {daysLeft != null && (
          <div className="flex items-center gap-1.5 text-xs bg-warning-light text-warning rounded-full px-2 py-0.5">
            <Calendar className="h-3.5 w-3.5" />
            Due in {daysLeft} day{daysLeft === 1 ? '' : 's'}
          </div>
        )}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-border">
        <div className="p-4">
          <div className="text-xs uppercase tracking-wide text-ink-muted">
            Output Tax (Collected)
          </div>
          <div className="mt-2 flex items-baseline justify-between">
            <span className="text-sm text-ink-muted">Standard rated sales</span>
            <span className="text-sm font-mono">{formatCurrency(data.netSales)}</span>
          </div>
          <div className="mt-1 flex items-baseline justify-between">
            <span className="text-sm text-ink-muted">VAT on sales (5%)</span>
            <span className="text-sm font-mono font-semibold">
              {formatCurrency(data.outputTax)}
            </span>
          </div>
        </div>
        <div className="p-4">
          <div className="text-xs uppercase tracking-wide text-ink-muted">
            Input Tax (Paid)
          </div>
          <div className="mt-2 flex items-baseline justify-between">
            <span className="text-sm text-ink-muted">Standard rated purchases</span>
            <span className="text-sm font-mono">{formatCurrency(data.netPurchases)}</span>
          </div>
          <div className="mt-1 flex items-baseline justify-between">
            <span className="text-sm text-ink-muted">VAT on purchases (5%)</span>
            <span className="text-sm font-mono font-semibold">
              {formatCurrency(data.inputTax)}
            </span>
          </div>
        </div>
      </div>
      <div className="px-4 py-3 border-t border-border flex items-center justify-between bg-surface-2">
        <span className="text-sm font-semibold text-ink">Net VAT Payable</span>
        <span
          className={cn(
            'text-lg font-mono font-semibold',
            data.netPayable >= 0 ? 'text-error' : 'text-success',
          )}
        >
          {formatCurrency(data.netPayable)}
        </span>
      </div>
      {dueDate && (
        <div className="px-4 py-2 text-xs text-ink-muted">
          Due date: {formatDate(data.dueDate)}
        </div>
      )}
    </div>
  );
}
