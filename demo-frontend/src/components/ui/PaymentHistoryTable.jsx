import { Banknote, Building2, FileSpreadsheet, Receipt, Trash2 } from 'lucide-react';
import Table from './Table.jsx';
import { formatCurrency } from '../../utils/format.js';
import { fileUrl } from '../../config.js';

const METHOD_META = {
  cash: { Icon: Banknote, label: 'Cash' },
  bank_transfer: { Icon: Building2, label: 'Bank transfer' },
  cheque: { Icon: FileSpreadsheet, label: 'Cheque' },
};

// Renders supplier payments with method icon. `onDelete(payment)` is optional
// and shown when the caller has the permission to reverse same-day entries.
export default function PaymentHistoryTable({
  payments,
  loading = false,
  showPo = true,
  onDelete,
}) {
  const columns = [
    {
      key: 'paymentDate',
      header: 'Date',
      render: (r) =>
        r.paymentDate ? new Date(r.paymentDate).toLocaleDateString() : '—',
    },
    {
      key: 'amount',
      header: 'Amount',
      align: 'right',
      render: (r) => (
        <span className="font-medium text-ink">{formatCurrency(r.amount)}</span>
      ),
    },
    {
      key: 'paymentMethod',
      header: 'Method',
      render: (r) => {
        const meta = METHOD_META[r.paymentMethod];
        const Icon = meta?.Icon || Banknote;
        return (
          <span className="inline-flex items-center gap-1.5 text-ink">
            <Icon size={14} className="text-ink-muted" />
            {meta?.label || r.paymentMethod}
          </span>
        );
      },
    },
    ...(showPo
      ? [
          {
            key: 'poNumber',
            header: 'PO #',
            render: (r) => r.poNumber || '—',
          },
        ]
      : []),
    {
      key: 'employeeUsername',
      header: 'By',
      render: (r) => r.employeeUsername || '—',
    },
    {
      key: 'receipt',
      header: '',
      sortable: false,
      width: '120px',
      align: 'right',
      render: (r) => (
        <div className="inline-flex items-center justify-end gap-1">
          {r.receiptAttachment && (
            <a
              href={fileUrl(r.receiptAttachment)}
              target="_blank"
              rel="noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="inline-flex h-7 w-7 items-center justify-center rounded-md text-ink-muted hover:bg-surface-2"
              title="View receipt"
            >
              <Receipt size={14} />
            </a>
          )}
          {onDelete && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onDelete(r);
              }}
              className="inline-flex h-7 w-7 items-center justify-center rounded-md text-error hover:bg-error-light"
              title="Reverse (same-day only)"
            >
              <Trash2 size={14} />
            </button>
          )}
        </div>
      ),
    },
  ];

  return (
    <Table
      columns={columns}
      rows={payments || []}
      loading={loading}
      empty="No payments recorded yet."
    />
  );
}
