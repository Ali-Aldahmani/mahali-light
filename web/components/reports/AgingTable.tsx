import { formatCell } from './ReportTable';
import Table, { type TableColumn } from '../ui/Table';

// Specialised view for aging reports (customer or supplier). Color-codes
// each bucket column by age so the eye lands on the worst column first.
const BUCKETS = [
  { key: 'current_amount', label: 'Current', tone: 'text-success' },
  { key: 'overdue_30',    label: '1–30 days', tone: 'text-ink' },
  { key: 'overdue_60',    label: '31–60 days', tone: 'text-warning' },
  { key: 'overdue_90',    label: '60+ days', tone: 'text-error' },
];

export default function AgingTable({
  report,
  entityLabel = 'Name',
  emptyHint,
}: {
  report: any;
  entityLabel?: string;
  emptyHint?: string;
}) {
  if (!report?.rows) return null;

  const columns: TableColumn[] = [
    { key: report.columns?.[0]?.key || 'name', header: entityLabel },
    ...BUCKETS.map(
      (b): TableColumn => ({
        key: b.key,
        header: b.label,
        align: 'right',
        render: (row) => (
          <span className={b.tone}>{formatCell(row[b.key], 'currency') || '—'}</span>
        ),
      }),
    ),
    {
      key: 'total',
      header: 'Total Due',
      align: 'right' as const,
      render: (row) => (
        <span className="font-semibold">{formatCell(row.total, 'currency')}</span>
      ),
    },
  ];

  return (
    <Table
      columns={columns}
      rows={report.rows}
      rowKey={(_row: any, idx?: number) => `aging-${idx}`}
      empty={emptyHint || 'No outstanding balances.'}
    />
  );
}
