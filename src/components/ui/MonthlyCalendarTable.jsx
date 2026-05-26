import { useMemo } from 'react';
import { cn } from '../../utils/cn.js';

// Color codes for cell states. Tailwind tokens are inlined so the table
// renders consistently even outside the design-system surfaces.
const STATUS_STYLES = {
  present: { bg: 'bg-emerald-50', text: 'text-emerald-700', letter: 'P' },
  late: { bg: 'bg-amber-50', text: 'text-amber-700', letter: 'L' },
  absent: { bg: 'bg-rose-50', text: 'text-rose-700', letter: 'A' },
  leave: { bg: 'bg-sky-50', text: 'text-sky-700', letter: 'LE' },
  half_day: { bg: 'bg-yellow-50', text: 'text-yellow-700', letter: 'H' },
};

// UAE weekend: Friday(5) + Saturday(6).
const WEEKEND = new Set([5, 6]);

function buildDayMetadata(year, month, daysInMonth, holidays) {
  const holidaySet = new Set((holidays || []).map((h) => h.date));
  return Array.from({ length: daysInMonth }, (_, idx) => {
    const day = idx + 1;
    const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const dow = new Date(`${dateStr}T00:00:00`).getDay();
    return {
      day,
      dateStr,
      isWeekend: WEEKEND.has(dow),
      isHoliday: holidaySet.has(dateStr),
    };
  });
}

function CellContent({ status }) {
  if (!status) return <span className="text-ink-muted">·</span>;
  const meta = STATUS_STYLES[status];
  if (!meta) return <span className="text-ink-muted">{status[0]?.toUpperCase()}</span>;
  return <span className={cn('font-semibold', meta.text)}>{meta.letter}</span>;
}

export default function MonthlyCalendarTable({
  month,
  year,
  daysInMonth,
  holidays = [],
  rows = [],
  onCellClick = null,
  onEmployeeClick = null,
}) {
  const days = useMemo(
    () => buildDayMetadata(year, month, daysInMonth, holidays),
    [year, month, daysInMonth, holidays],
  );

  return (
    <div className="overflow-auto rounded-card border border-border bg-surface shadow-card">
      <table className="min-w-full border-separate border-spacing-0 text-sm">
        <thead className="sticky top-0 z-10 bg-surface">
          <tr>
            <th
              className="sticky left-0 z-20 min-w-[200px] border-b border-r border-border bg-surface px-3 py-2 text-left text-xs font-semibold uppercase text-ink-muted"
            >
              Employee
            </th>
            {days.map((d) => (
              <th
                key={d.day}
                className={cn(
                  'min-w-[36px] border-b border-border px-1 py-2 text-center text-xs font-semibold',
                  d.isHoliday ? 'bg-slate-100 text-slate-700' : 'bg-surface text-ink-muted',
                  d.isWeekend && !d.isHoliday && 'bg-surface-2',
                )}
                title={d.isHoliday ? holidays.find((h) => h.date === d.dateStr)?.name : ''}
              >
                {d.day}
              </th>
            ))}
            <th className="border-b border-border bg-surface px-3 py-2 text-right text-xs font-semibold uppercase text-ink-muted">
              P
            </th>
            <th className="border-b border-border bg-surface px-2 py-2 text-right text-xs font-semibold uppercase text-ink-muted">
              L
            </th>
            <th className="border-b border-border bg-surface px-2 py-2 text-right text-xs font-semibold uppercase text-ink-muted">
              A
            </th>
            <th className="border-b border-border bg-surface px-2 py-2 text-right text-xs font-semibold uppercase text-ink-muted">
              LE
            </th>
            <th className="border-b border-border bg-surface px-3 py-2 text-right text-xs font-semibold uppercase text-ink-muted">
              Hrs
            </th>
            <th className="border-b border-border bg-surface px-3 py-2 text-right text-xs font-semibold uppercase text-ink-muted">
              OT
            </th>
            <th className="border-b border-border bg-surface px-3 py-2 text-right text-xs font-semibold uppercase text-ink-muted">
              Short
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td
                colSpan={daysInMonth + 8}
                className="px-4 py-8 text-center text-sm text-ink-muted"
              >
                No data for this month.
              </td>
            </tr>
          )}
          {rows.map((row) => (
            <tr key={row.employeeId}>
              <td
                className="sticky left-0 z-10 border-b border-r border-border bg-surface px-3 py-2 font-medium"
              >
                <button
                  type="button"
                  onClick={() => onEmployeeClick && onEmployeeClick(row)}
                  className="text-left text-ink hover:text-accent disabled:cursor-default"
                  disabled={!onEmployeeClick}
                >
                  {row.employeeName}
                  {row.roleTitle && (
                    <div className="text-xs font-normal text-ink-muted">
                      {row.roleTitle}
                    </div>
                  )}
                </button>
              </td>
              {days.map((d) => {
                const record = row.days?.[d.day];
                const status = record?.status;
                const cellMeta = status ? STATUS_STYLES[status] : null;
                const isHoliday = d.isHoliday && !status;
                return (
                  <td
                    key={d.day}
                    className={cn(
                      'border-b border-border px-1 py-2 text-center align-middle',
                      cellMeta?.bg,
                      isHoliday && 'bg-slate-100',
                      d.isWeekend && !cellMeta && !isHoliday && 'bg-surface-2',
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => onCellClick && onCellClick({ row, day: d, record })}
                      className="block w-full text-xs hover:opacity-70 disabled:cursor-default"
                      disabled={!onCellClick}
                      title={
                        record
                          ? `${status} — ${record.workingHours || 0}h`
                          : isHoliday
                          ? holidays.find((h) => h.date === d.dateStr)?.name
                          : ''
                      }
                    >
                      {isHoliday ? <span className="text-slate-500">H</span> : <CellContent status={status} />}
                    </button>
                  </td>
                );
              })}
              <td className="border-b border-border px-3 py-2 text-right text-xs">
                {row.summary?.present || 0}
              </td>
              <td className="border-b border-border px-2 py-2 text-right text-xs">
                {row.summary?.late || 0}
              </td>
              <td className="border-b border-border px-2 py-2 text-right text-xs">
                {row.summary?.absent || 0}
              </td>
              <td className="border-b border-border px-2 py-2 text-right text-xs">
                {row.summary?.leave || 0}
              </td>
              <td className="border-b border-border px-3 py-2 text-right text-xs tabular-nums">
                {(row.summary?.totalHours || 0).toFixed(1)}
              </td>
              <td className="border-b border-border px-3 py-2 text-right text-xs tabular-nums">
                {(row.summary?.overtimeHours || 0).toFixed(1)}
              </td>
              <td className="border-b border-border px-3 py-2 text-right text-xs tabular-nums">
                {(row.summary?.shortageHours || 0).toFixed(1)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
