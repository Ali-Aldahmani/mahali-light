import Badge from './Badge.jsx';

// Visualize a stock level relative to a reorder threshold.
// - 0 stock        → red
// - 0 < x <= max(threshold, 1) → yellow
// - otherwise      → green
export default function StockBadge({
  qty,
  threshold = 0,
  unitLabel = '',
  size = 'md',
  showQty = true,
}) {
  const n = Number(qty || 0);
  const t = Number(threshold || 0);

  let tone = 'success';
  if (n <= 0) tone = 'error';
  else if (n <= Math.max(t, 1) && t > 0) tone = 'warning';
  else if (t > 0 && n <= t) tone = 'warning';

  const display = formatQty(n);
  return (
    <Badge tone={tone} size={size} dot>
      {showQty ? `${display}${unitLabel ? ` ${unitLabel}` : ''}` : ''}
    </Badge>
  );
}

function formatQty(n) {
  if (Number.isInteger(n)) return String(n);
  return n.toFixed(2).replace(/\.?0+$/, '');
}
