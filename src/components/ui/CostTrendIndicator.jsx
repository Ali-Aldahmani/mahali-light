import { ArrowDown, ArrowUp, Minus } from 'lucide-react';
import { formatCurrency } from '../../utils/format.js';

// Visualises the direction & magnitude of a cost change between two purchases.
// `current` and `previous` are numbers; when previous is null we render a
// neutral indicator and the absolute current cost as helper text.
export default function CostTrendIndicator({
  current,
  previous,
  showAmount = true,
  size = 'sm',
}) {
  const hasPrev = previous != null && Number.isFinite(Number(previous));
  const cur = Number(current || 0);
  const prev = hasPrev ? Number(previous) : null;
  const diff = hasPrev ? cur - prev : 0;
  const pct = hasPrev && prev > 0 ? (diff / prev) * 100 : null;

  let tone = 'text-ink-muted';
  let Icon = Minus;
  let label = '—';

  if (!hasPrev) {
    label = 'first purchase';
  } else if (diff > 0.001) {
    tone = 'text-error';
    Icon = ArrowUp;
    label =
      pct != null ? `+${pct.toFixed(1)}%` : `+${formatCurrency(Math.abs(diff))}`;
  } else if (diff < -0.001) {
    tone = 'text-success';
    Icon = ArrowDown;
    label =
      pct != null ? `${pct.toFixed(1)}%` : `-${formatCurrency(Math.abs(diff))}`;
  } else {
    label = 'no change';
  }

  const iconSize = size === 'lg' ? 16 : 14;

  return (
    <div className={`inline-flex items-center gap-1 text-xs ${tone}`}>
      <Icon size={iconSize} />
      <span>{label}</span>
      {showAmount && (
        <span className="text-ink-muted">· {formatCurrency(cur)}</span>
      )}
    </div>
  );
}
