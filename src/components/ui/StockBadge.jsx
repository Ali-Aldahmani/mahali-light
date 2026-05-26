import Badge from './Badge.jsx';

// Visualize a stock level relative to a reorder threshold.
//
//   variant            tone      meaning
//   -----------------  --------  -------------------------------------
//   in_stock           success   qty > threshold (or threshold disabled)
//   low_stock          warning   0 < qty <= threshold (threshold > 0)
//   out_of_stock       error     qty <= 0
//   quarantine         neutral   shown when displaying quarantine qty
//
// If `variant` is provided we use it directly. Otherwise we derive from
// qty + threshold.
export default function StockBadge({
  qty,
  threshold = 0,
  unitLabel = '',
  variant,
  size = 'md',
  showQty = true,
  showLabel = false,
}) {
  const n = Number(qty || 0);
  const t = Number(threshold || 0);

  const derived =
    variant ||
    (n <= 0
      ? 'out_of_stock'
      : t > 0 && n <= t
        ? 'low_stock'
        : 'in_stock');

  const TONE = {
    in_stock: 'success',
    low_stock: 'warning',
    out_of_stock: 'error',
    quarantine: 'neutral',
  };
  const LABEL = {
    in_stock: 'In Stock',
    low_stock: 'Low Stock',
    out_of_stock: 'Out of Stock',
    quarantine: 'Quarantine',
  };

  const tone = TONE[derived] || 'neutral';
  const display = formatQty(n);
  const title = t > 0 ? `Reorder threshold: ${formatQty(t)}${unitLabel ? ' ' + unitLabel : ''}` : undefined;

  return (
    <span title={title} className="inline-flex">
      <Badge tone={tone} size={size} dot>
        {showQty && `${display}${unitLabel ? ` ${unitLabel}` : ''}`}
        {showQty && showLabel ? ' · ' : ''}
        {showLabel ? LABEL[derived] : ''}
      </Badge>
    </span>
  );
}

function formatQty(n) {
  if (Number.isInteger(n)) return String(n);
  return n.toFixed(2).replace(/\.?0+$/, '');
}
