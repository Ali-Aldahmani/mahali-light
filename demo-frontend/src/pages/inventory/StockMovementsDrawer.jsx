import { useEffect, useState } from 'react';
import SlideOver from '../../components/ui/SlideOver.jsx';
import Select from '../../components/ui/Select.jsx';
import StockMovementTimeline from '../../components/ui/StockMovementTimeline.jsx';
import { listVariantMovements } from '../../services/stockService.js';
import { MOVEMENT_TYPES, getMovementTypeLabel } from '../../components/ui/MovementTypeBadge.jsx';

const FILTER_OPTIONS = [
  { value: 'all', label: 'All movement types' },
  ...MOVEMENT_TYPES.map((t) => ({ value: t, label: getMovementTypeLabel(t) })),
];

export default function StockMovementsDrawer({ open, onClose, variant }) {
  const [movements, setMovements] = useState([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState('all');

  useEffect(() => {
    if (!open || !variant?.variantId) return undefined;
    let aborted = false;
    setLoading(true);
    listVariantMovements(variant.variantId, {
      movementType: filter === 'all' ? undefined : filter,
      limit: 200,
    })
      .then((res) => {
        if (!aborted) setMovements(res || []);
      })
      .catch(() => {
        if (!aborted) setMovements([]);
      })
      .finally(() => {
        if (!aborted) setLoading(false);
      });
    return () => {
      aborted = true;
    };
  }, [open, variant?.variantId, filter]);

  if (!variant) return null;

  return (
    <SlideOver
      open={open}
      onClose={onClose}
      width="lg"
      title="Stock movements"
      subtitle={
        <span>
          {variant.productName} · SKU {variant.sku}
        </span>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-3 gap-3">
          <Stat label="Current" value={`${variant.stockQty} ${variant.unitLabel || ''}`} />
          <Stat
            label="Quarantine"
            value={`${variant.quarantineQty || 0} ${variant.unitLabel || ''}`}
          />
          <Stat label="Threshold" value={variant.reorderThreshold || '—'} />
        </div>

        <Select
          value={filter}
          onChange={setFilter}
          options={FILTER_OPTIONS}
          label="Filter"
          searchable={false}
        />

        <div className="pt-2">
          <StockMovementTimeline movements={movements} loading={loading} />
        </div>
      </div>
    </SlideOver>
  );
}

function Stat({ label, value }) {
  return (
    <div className="rounded-xl border border-border bg-surface-2 p-3">
      <div className="text-xs text-ink-muted">{label}</div>
      <div className="text-base font-semibold text-ink">{value}</div>
    </div>
  );
}
