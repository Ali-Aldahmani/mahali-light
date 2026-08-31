import Badge from './Badge.jsx';
import { formatCurrency } from '../../utils/format.js';

// Compact badge for showing a customer's credit_balance in tables and
// summary cards. Renders a muted dash when the balance is zero, an orange
// "owes" badge when positive, and red when the limit is exceeded.
export default function CreditBalanceBadge({
  balance,
  limit = 0,
  size = 'sm',
  showZero = true,
}) {
  const b = Number(balance || 0);
  if (b <= 0.001) {
    if (!showZero) return null;
    return (
      <Badge tone="muted" size={size}>
        —
      </Badge>
    );
  }

  const overLimit = limit > 0 && b > Number(limit) + 0.001;
  const tone = overLimit ? 'error' : 'warning';
  return (
    <Badge tone={tone} size={size} dot>
      <span title="Customer owes this amount">{formatCurrency(b)}</span>
    </Badge>
  );
}
