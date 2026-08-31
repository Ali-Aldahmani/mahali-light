import { CheckCircle2, AlertCircle } from 'lucide-react';
import { cn } from '../../utils/cn.js';
import { formatCurrency } from '../../utils/format.js';

// Renders the lines of one journal entry with debits + credits side-by-side
// and a running balance check below.
export default function JournalEntryTable({ lines = [], className = '' }) {
  const totalDebit = lines.reduce((s, l) => s + (Number(l.debit) || 0), 0);
  const totalCredit = lines.reduce((s, l) => s + (Number(l.credit) || 0), 0);
  const balanced = Math.abs(totalDebit - totalCredit) < 0.01 && totalDebit > 0;
  return (
    <div className={cn('rounded-card border border-border overflow-hidden', className)}>
      <table className="w-full">
        <thead>
          <tr className="border-b border-border bg-surface-2 text-xs uppercase tracking-wide text-ink-muted">
            <th className="text-left py-2 px-3">Code</th>
            <th className="text-left py-2 px-3">Account</th>
            <th className="text-right py-2 px-3">Debit</th>
            <th className="text-right py-2 px-3">Credit</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l) => (
            <tr key={l.id || `${l.accountCode}-${l.debit}-${l.credit}`} className="border-b border-border last:border-b-0">
              <td className="py-2 px-3 text-sm font-mono">{l.accountCode}</td>
              <td className="py-2 px-3 text-sm">
                <div className="text-ink">{l.accountName}</div>
                {l.notes && <div className="text-xs text-ink-muted">{l.notes}</div>}
              </td>
              <td className="py-2 px-3 text-sm text-right font-mono">
                {l.debit > 0 ? formatCurrency(l.debit) : ''}
              </td>
              <td className="py-2 px-3 text-sm text-right font-mono">
                {l.credit > 0 ? formatCurrency(l.credit) : ''}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="bg-surface-2 font-semibold">
            <td colSpan={2} className="py-2 px-3 text-sm flex items-center gap-2">
              {balanced ? (
                <span className="inline-flex items-center gap-1 text-success">
                  <CheckCircle2 className="h-4 w-4" /> Balanced
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 text-error">
                  <AlertCircle className="h-4 w-4" /> Not balanced
                </span>
              )}
            </td>
            <td className="py-2 px-3 text-sm text-right font-mono">
              {formatCurrency(totalDebit)}
            </td>
            <td className="py-2 px-3 text-sm text-right font-mono">
              {formatCurrency(totalCredit)}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
