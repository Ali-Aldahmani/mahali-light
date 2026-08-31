import { Trash2 } from 'lucide-react';
import Table from './Table.jsx';
import { fileUrl } from '../../config.js';
import { formatCurrency, formatQty } from '../../utils/format.js';

function ProgressBar({ value }) {
  const v = Math.max(0, Math.min(100, value));
  let tone = 'bg-accent';
  if (v >= 100) tone = 'bg-success';
  else if (v === 0) tone = 'bg-surface-2';
  return (
    <div className="w-24 h-1.5 rounded-full bg-surface-2 overflow-hidden">
      <div className={`h-full ${tone}`} style={{ width: `${v}%` }} />
    </div>
  );
}

// Renders PO items either editable (during creation) or read-only (during
// detail/receive workflows). When `editable` is true the parent must supply
// `onChange(index, patch)` and `onRemove(index)` callbacks.
export default function POItemsTable({
  items = [],
  editable = false,
  showCost = true,
  showProgress = true,
  onChange,
  onRemove,
}) {
  const columns = [
    {
      key: 'product',
      header: 'Product',
      sortable: false,
      render: (r) => (
        <div className="flex items-center gap-2">
          <div className="h-8 w-8 rounded bg-surface-2 overflow-hidden flex items-center justify-center text-xs text-ink-muted shrink-0">
            {r.productImage ? (
              <img
                src={fileUrl(r.productImage)}
                alt=""
                className="h-full w-full object-cover"
              />
            ) : (
              '—'
            )}
          </div>
          <div className="min-w-0">
            <div className="text-sm font-medium text-ink truncate">
              {r.productName}
            </div>
            <div className="text-xs text-ink-muted truncate">
              SKU: {r.sku} {r.barcode ? `· ${r.barcode}` : ''}
            </div>
          </div>
        </div>
      ),
    },
    {
      key: 'quantity',
      header: editable ? 'Qty' : 'Ordered',
      align: 'right',
      sortable: false,
      render: (r, idx) =>
        editable ? (
          <input
            type="number"
            min={0}
            step="0.01"
            value={r.quantity ?? ''}
            onChange={(e) => onChange?.(idx, { quantity: Number(e.target.value) })}
            className="w-24 h-9 rounded-input border border-border bg-surface px-2 text-right text-sm focus:border-accent focus:outline-none"
          />
        ) : (
          <span>
            {formatQty(r.quantity)} {r.unitLabel || ''}
          </span>
        ),
    },
    ...(editable
      ? []
      : [
          {
            key: 'received',
            header: 'Received',
            align: 'right',
            sortable: false,
            render: (r) => (
              <div className="flex items-center justify-end gap-2">
                <span>{formatQty(r.quantityReceived || 0)}</span>
                {showProgress && (
                  <ProgressBar
                    value={
                      Number(r.quantity) > 0
                        ? (Number(r.quantityReceived || 0) /
                            Number(r.quantity)) *
                          100
                        : 0
                    }
                  />
                )}
              </div>
            ),
          },
        ]),
    ...(showCost
      ? [
          {
            key: 'costPricePerUnit',
            header: 'Unit cost',
            align: 'right',
            sortable: false,
            render: (r, idx) =>
              editable ? (
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  value={r.costPricePerUnit ?? ''}
                  onChange={(e) =>
                    onChange?.(idx, {
                      costPricePerUnit: Number(e.target.value),
                    })
                  }
                  className="w-24 h-9 rounded-input border border-border bg-surface px-2 text-right text-sm focus:border-accent focus:outline-none"
                />
              ) : (
                formatCurrency(r.costPricePerUnit)
              ),
          },
          {
            key: 'totalCost',
            header: 'Total',
            align: 'right',
            sortable: false,
            render: (r) =>
              formatCurrency(
                editable
                  ? Number(r.quantity || 0) * Number(r.costPricePerUnit || 0)
                  : r.totalCost,
              ),
          },
        ]
      : []),
    ...(editable
      ? [
          {
            key: 'remove',
            header: '',
            sortable: false,
            width: '60px',
            align: 'right',
            render: (_r, idx) => (
              <button
                type="button"
                onClick={() => onRemove?.(idx)}
                className="inline-flex h-7 w-7 items-center justify-center rounded-md text-error hover:bg-error-light"
                aria-label="Remove item"
              >
                <Trash2 size={14} />
              </button>
            ),
          },
        ]
      : []),
  ];

  // Patch the Table component to pass row index through. Table only passes the
  // row to render, but our editable inputs need it — so we synthesise the key
  // by mapping rows to include an _idx field for stable identity.
  const rows = items.map((r, idx) => ({ ...r, _idx: idx }));
  const wrappedColumns = columns.map((col) => ({
    ...col,
    render: col.render ? (row) => col.render(row, row._idx) : col.render,
  }));

  return (
    <Table
      columns={wrappedColumns}
      rows={rows}
      rowKey={(r) => r.id || `idx-${r._idx}`}
      empty={editable ? 'Add items to this purchase order.' : 'No items.'}
    />
  );
}
