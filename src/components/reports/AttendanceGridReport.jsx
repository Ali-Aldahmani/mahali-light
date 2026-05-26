import { cn } from '../../utils/cn.js';

// Color map for each attendance status. Keeps the on-screen grid in sync
// with the exported sheets.
const STATUS_STYLES = {
  present: { bg: 'bg-success-light', label: 'P', tone: 'text-success' },
  late:    { bg: 'bg-warning-light', label: 'L', tone: 'text-warning' },
  absent:  { bg: 'bg-error-light',   label: 'A', tone: 'text-error' },
  leave:   { bg: 'bg-accent-light',  label: 'Lv', tone: 'text-accent' },
  half_day:{ bg: 'bg-warning-light', label: 'H', tone: 'text-warning' },
};

export default function AttendanceGridReport({ report }) {
  if (!report?.grid) return null;
  const days = report.days || [];
  return (
    <div className="card border border-border overflow-x-auto">
      <table className="text-xs">
        <thead>
          <tr className="bg-surface-2 text-ink-muted">
            <th className="sticky left-0 z-10 bg-surface-2 text-left px-3 py-2 border-r border-border min-w-[160px]">
              Employee
            </th>
            {days.map((d) => (
              <th key={d} className="text-center px-1 py-2 font-semibold w-8">
                {d}
              </th>
            ))}
            <th className="px-2 py-2 text-right">P</th>
            <th className="px-2 py-2 text-right">A</th>
            <th className="px-2 py-2 text-right">L</th>
            <th className="px-2 py-2 text-right">Lv</th>
            <th className="px-2 py-2 text-right">Hrs</th>
          </tr>
        </thead>
        <tbody>
          {report.rows.map((row, idx) => (
            <tr
              key={`att-${idx}`}
              className={cn('border-t border-border', idx % 2 ? 'bg-surface' : 'bg-bg/40')}
            >
              <td className="sticky left-0 z-10 bg-inherit px-3 py-2 border-r border-border font-medium text-ink">
                {row.name}
              </td>
              {days.map((d) => {
                const status = row[`d${d}`];
                const style = STATUS_STYLES[status];
                return (
                  <td
                    key={d}
                    className={cn(
                      'text-center px-1 py-2 font-medium',
                      style?.bg,
                      style?.tone,
                    )}
                  >
                    {style?.label || ''}
                  </td>
                );
              })}
              <td className="px-2 py-2 text-right tabular-nums">{row.present_days}</td>
              <td className="px-2 py-2 text-right tabular-nums">{row.absent_days}</td>
              <td className="px-2 py-2 text-right tabular-nums">{row.late_days}</td>
              <td className="px-2 py-2 text-right tabular-nums">{row.leave_days}</td>
              <td className="px-2 py-2 text-right tabular-nums">{row.hours_total}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
