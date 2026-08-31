import MovementTypeBadge, { getMovementTypeLabel } from './MovementTypeBadge.jsx';
import { formatRelativeTime, formatQty } from '../../utils/format.js';

function refLabel(m) {
  if (!m.referenceType) return null;
  const map = {
    invoice: 'Invoice',
    purchase_order: 'PO',
    purchase: 'Purchase',
    adjustment_request: 'Adjustment',
    adjustment_direct: 'Adjustment',
    stock_count: 'Count',
    return_order: 'Return',
  };
  return map[m.referenceType] || m.referenceType;
}

export default function StockMovementTimeline({
  movements,
  loading,
  emptyText = 'No movements yet.',
}) {
  if (loading) {
    return (
      <div className="py-12 text-center text-ink-muted text-sm">
        Loading movements…
      </div>
    );
  }
  if (!movements || !movements.length) {
    return (
      <div className="py-12 text-center text-ink-muted text-sm">{emptyText}</div>
    );
  }

  return (
    <ol className="relative border-l border-border ml-2 pl-6 space-y-5">
      {movements.map((m) => {
        const delta = Number(m.quantity);
        const positive = delta > 0;
        return (
          <li key={m.id} className="relative">
            <span className="absolute -left-[33px] top-1.5 h-3 w-3 rounded-full border-2 border-surface bg-bg shadow-sm" />
            <div className="flex flex-wrap items-center gap-3">
              <MovementTypeBadge type={m.movementType} size="sm" />
              <span
                className={
                  positive
                    ? 'text-success font-semibold text-sm'
                    : 'text-error font-semibold text-sm'
                }
              >
                {positive ? '+' : ''}
                {formatQty(delta)}
                {m.unitLabel ? ` ${m.unitLabel}` : ''}
              </span>
              <span className="text-xs text-ink-muted">
                {formatQty(m.qtyBefore)} → {formatQty(m.qtyAfter)}
                {m.unitLabel ? ` ${m.unitLabel}` : ''}
              </span>
              {refLabel(m) && (
                <span className="text-xs px-2 py-0.5 rounded-md bg-surface-2 text-ink-muted">
                  {refLabel(m)}
                </span>
              )}
            </div>
            <div className="mt-1 text-xs text-ink-muted flex flex-wrap items-center gap-2">
              <span>{m.employeeUsername || 'system'}</span>
              <span>·</span>
              <span title={new Date(m.timestamp).toLocaleString()}>
                {formatRelativeTime(m.timestamp)}
              </span>
              {m.notes && (
                <>
                  <span>·</span>
                  <span className="italic">{m.notes}</span>
                </>
              )}
            </div>
            {/* fallback type label for assistive tech */}
            <span className="sr-only">{getMovementTypeLabel(m.movementType)}</span>
          </li>
        );
      })}
    </ol>
  );
}
