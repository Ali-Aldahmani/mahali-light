import { ArrowDown, ArrowUp } from 'lucide-react';
import { cn } from '../../utils/cn.js';

export default function TransactionDirectionBadge({
  direction,
  amount,
  size = 'md',
  className = '',
}) {
  const isIn = direction === 'in';
  const sizeCls = size === 'sm' ? 'text-xs h-5 px-2' : 'text-sm h-6 px-2.5';
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full font-medium whitespace-nowrap',
        isIn ? 'bg-success-light text-success' : 'bg-error-light text-error',
        sizeCls,
        className,
      )}
    >
      {isIn ? <ArrowDown className="h-3 w-3" /> : <ArrowUp className="h-3 w-3" />}
      {amount != null ? (
        <span>
          {isIn ? '+' : '-'}
          {Number(amount).toFixed(2)}
        </span>
      ) : (
        <span>{isIn ? 'IN' : 'OUT'}</span>
      )}
    </span>
  );
}
