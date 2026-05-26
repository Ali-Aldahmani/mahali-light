import Table from '../ui/Table.jsx';
import { formatCell } from './ReportTable.jsx';

// Compact dedicated view for the payroll report. Bolds the net column
// since that is what HR uses to cross-check the actual payout.
export default function PayrollSummaryTable({ report }) {
  if (!report) return null;
  const cols = [
    { key: 'name',            header: 'Employee' },
    { key: 'role_title',      header: 'Role' },
    { key: 'salary_type',     header: 'Type' },
    { key: 'days_worked',     header: 'Days',       align: 'right', render: (r) => r.days_worked ?? 0 },
    { key: 'hours_worked',    header: 'Hours',      align: 'right', render: (r) => formatCell(r.hours_worked, 'number') },
    { key: 'overtime_hours',  header: 'OT Hrs',     align: 'right', render: (r) => formatCell(r.overtime_hours, 'number') },
    { key: 'gross',           header: 'Gross',      align: 'right', render: (r) => formatCell(r.gross, 'currency') },
    { key: 'deductions',      header: 'Deductions', align: 'right', render: (r) => formatCell(r.deductions, 'currency') },
    { key: 'overtime_pay',    header: 'OT Pay',     align: 'right', render: (r) => formatCell(r.overtime_pay, 'currency') },
    {
      key: 'net',
      header: 'Net Salary',
      align: 'right',
      render: (r) => (
        <span className="font-semibold text-accent">{formatCell(r.net, 'currency')}</span>
      ),
    },
  ];
  return (
    <Table
      columns={cols}
      rows={report.rows || []}
      rowKey={(_row, idx) => `pay-${idx}`}
      empty="No payroll data for this period."
    />
  );
}
