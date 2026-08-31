import { useMemo, useState } from 'react';
import { Minus, Package, Plus, X } from 'lucide-react';
import Button from '../ui/Button.jsx';
import Input from '../ui/Input.jsx';
import Badge from '../ui/Badge.jsx';
import { fileUrl } from '../../config.js';
import { formatCurrency } from '../../utils/format.js';

// Modal-style variant picker for products with attributes. The parent passes
// an initially-selected variant; the cashier may switch to a sibling variant
// (same productId), pick a quantity, and add to cart.
//
// `siblings` is the list of variants returned by /products/search that
// share the same productId — we filter the list to ensure the picker only
// shows truly related variants.
export default function POSVariantSelector({
  open,
  onClose,
  variant,
  siblings = [],
  onAdd,
}) {
  const [selectedId, setSelectedId] = useState(variant?.variantId || null);
  const [qty, setQty] = useState(1);

  // Reset when modal reopens.
  useMemo(() => {
    if (open) {
      setSelectedId(variant?.variantId || null);
      setQty(1);
    }
    return null;
  }, [open, variant]);

  const variants = useMemo(() => {
    const sibs = Array.isArray(siblings) ? siblings : [];
    const list = sibs.filter((v) => v.productId === variant?.productId);
    if (!list.some((v) => v.variantId === variant?.variantId)) {
      // Always include the originally clicked variant.
      return variant ? [variant, ...list] : list;
    }
    return list;
  }, [siblings, variant]);

  if (!open || !variant) return null;

  const selected =
    variants.find((v) => v.variantId === selectedId) || variant;
  const stock = Number(selected.stockQty || 0);
  const isDecimal = selected.soldBy && selected.soldBy !== 'piece';

  // Build attribute → values map across all siblings to render pills.
  const attributeMap = new Map();
  for (const v of variants) {
    for (const a of v.attributes || []) {
      if (!attributeMap.has(a.attributeName)) {
        attributeMap.set(a.attributeName, new Map());
      }
      const valsMap = attributeMap.get(a.attributeName);
      const key = `${a.value}${a.unit || ''}`;
      if (!valsMap.has(key)) {
        valsMap.set(key, { value: a.value, unit: a.unit, variantIds: [] });
      }
      valsMap.get(key).variantIds.push(v.variantId);
    }
  }

  function pickValue(attrName, valueKey) {
    const valsMap = attributeMap.get(attrName);
    const def = valsMap.get(valueKey);
    if (!def) return;
    // Prefer a sibling that also matches all other currently selected attrs.
    const currentAttrs = (selected.attributes || []).reduce((m, a) => {
      m[a.attributeName] = `${a.value}${a.unit || ''}`;
      return m;
    }, {});
    currentAttrs[attrName] = valueKey;
    const next = variants.find((v) =>
      Object.entries(currentAttrs).every(([n, val]) =>
        (v.attributes || []).some(
          (a) => a.attributeName === n && `${a.value}${a.unit || ''}` === val,
        ),
      ),
    );
    setSelectedId((next || { variantId: def.variantIds[0] }).variantId);
  }

  function handleAdd() {
    if (!selected || stock <= 0) return;
    onAdd?.(selected, Number(qty) || 1);
    onClose?.();
  }

  function adjustQty(delta) {
    setQty((q) => {
      const next = Number(q) + delta;
      return Math.max(isDecimal ? 0.01 : 1, Number(next.toFixed(2)));
    });
  }

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose?.();
      }}
    >
      <div className="w-full max-w-lg rounded-card bg-surface border border-border shadow-pop overflow-hidden">
        <div className="flex items-start gap-3 p-4 border-b border-border">
          <div className="h-16 w-16 shrink-0 rounded-md bg-surface-2 overflow-hidden flex items-center justify-center">
            {selected.imagePath ? (
              <img
                src={fileUrl(selected.imagePath)}
                alt={selected.productName}
                className="h-full w-full object-cover"
              />
            ) : (
              <Package className="h-7 w-7 text-ink-muted" />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-base font-semibold text-ink truncate">
              {selected.productName}
            </div>
            {selected.sku && (
              <div className="text-xs text-ink-muted">{selected.sku}</div>
            )}
            <div className="mt-1 flex items-center gap-2">
              <span className="text-lg font-semibold text-accent">
                {formatCurrency(selected.sellingPrice || 0)}
              </span>
              <Badge
                tone={stock > 5 ? 'success' : stock > 0 ? 'warning' : 'error'}
                size="sm"
              >
                {stock > 0 ? `${stock} ${selected.unitLabel || ''}` : 'Out'}
              </Badge>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-8 w-8 items-center justify-center rounded-full text-ink-muted hover:bg-surface-2"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-4 space-y-4 max-h-[60vh] overflow-y-auto">
          {[...attributeMap.entries()].map(([attrName, valsMap]) => {
            const current = (selected.attributes || []).find(
              (a) => a.attributeName === attrName,
            );
            const currentKey = current
              ? `${current.value}${current.unit || ''}`
              : null;
            return (
              <div key={attrName}>
                <div className="text-xs font-medium text-ink-muted mb-2">
                  {attrName}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {[...valsMap.entries()].map(([key, def]) => {
                    const active = currentKey === key;
                    return (
                      <button
                        type="button"
                        key={key}
                        onClick={() => pickValue(attrName, key)}
                        className={[
                          'rounded-full px-3 py-1.5 text-xs font-medium border transition',
                          active
                            ? 'bg-accent-light text-accent border-accent'
                            : 'bg-surface text-ink border-border hover:bg-surface-2',
                        ].join(' ')}
                      >
                        {def.value}
                        {def.unit || ''}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}

          <div>
            <div className="text-xs font-medium text-ink-muted mb-2">
              Quantity{isDecimal ? ` (${selected.unitLabel})` : ''}
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => adjustQty(-1)}
              >
                <Minus className="h-4 w-4" />
              </Button>
              <div className="w-24">
                <Input
                  type="number"
                  min={isDecimal ? 0.01 : 1}
                  step={isDecimal ? '0.01' : '1'}
                  value={qty}
                  onChange={(e) => setQty(e.target.value)}
                />
              </div>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => adjustQty(1)}
              >
                <Plus className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>

        <div className="p-4 border-t border-border flex items-center justify-between gap-2">
          <div>
            <div className="text-xs text-ink-muted">Line total</div>
            <div className="text-lg font-semibold text-ink">
              {formatCurrency(
                Number(qty || 0) * Number(selected.sellingPrice || 0),
              )}
            </div>
          </div>
          <Button
            onClick={handleAdd}
            disabled={stock <= 0 || Number(qty) <= 0}
          >
            Add to cart
          </Button>
        </div>
      </div>
    </div>
  );
}
