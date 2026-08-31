import { cn } from '../../utils/cn.js';

// Visualizes a leave balance: used vs total. The bar tints green→orange→red
// as utilization increases so a manager can spot near-exhausted balances at
// a glance.
export default function LeaveBalanceBar({
  used = 0,
  total = 0,
  carriedOver = 0,
  size = 'md',
  showLabel = true,
  className = '',
}) {
  const denom = Number(total) + Number(carriedOver);
  const usedNum = Math.max(0, Number(used));
  const pct = denom > 0 ? Math.min(100, (usedNum / denom) * 100) : 0;
  const remaining = Math.max(0, denom - usedNum);

  let barColor = 'bg-success';
  if (pct >= 90) barColor = 'bg-error';
  else if (pct >= 70) barColor = 'bg-warning';
  else if (pct >= 40) barColor = 'bg-accent';

  const heightClass = size === 'sm' ? 'h-1.5' : size === 'lg' ? 'h-3' : 'h-2';

  return (
    <div className={cn('w-full', className)}>
      {showLabel && (
        <div className="mb-1 flex items-center justify-between text-xs">
          <span className="text-ink-muted">
            {usedNum} used / {denom} total
            {carriedOver ? ` (incl. ${carriedOver} carried)` : ''}
          </span>
          <span className="font-medium">
            {remaining} day{remaining === 1 ? '' : 's'} left
          </span>
        </div>
      )}
      <div className={cn('w-full rounded-full bg-surface-2', heightClass)}>
        <div
          className={cn('rounded-full transition-all duration-300', heightClass, barColor)}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
