import { Trophy, Medal, Award } from 'lucide-react';
import { cn } from '../../utils/cn.js';
import { formatCell } from './ReportTable.jsx';

// Ranked list with medal icons for top 3 and a progress bar relative to
// the top performer's revenue.
const PODIUM = [
  { icon: Trophy, tone: 'text-yellow-500' },
  { icon: Medal, tone: 'text-slate-400' },
  { icon: Award, tone: 'text-amber-700' },
];

export default function EmployeeLeaderboard({ report, metricKey = 'revenue', labelKey = 'employee_name' }) {
  const rows = (report?.rows || [])
    .slice()
    .sort((a, b) => Number(b[metricKey] || 0) - Number(a[metricKey] || 0));
  if (!rows.length) {
    return (
      <p className="text-sm text-ink-muted p-4 text-center">
        No data for the selected period.
      </p>
    );
  }
  const top = Math.max(1, Number(rows[0][metricKey]) || 0);
  return (
    <div className="card border border-border p-4">
      <ol className="flex flex-col gap-2">
        {rows.map((r, idx) => {
          const Decoration = PODIUM[idx];
          const value = Number(r[metricKey]) || 0;
          const pct = Math.max(2, Math.round((value / top) * 100));
          return (
            <li
              key={`${r[labelKey]}-${idx}`}
              className="flex items-center gap-3 py-2 border-b border-border/60 last:border-b-0"
            >
              <span className="w-7 text-center font-semibold text-ink-muted">{idx + 1}</span>
              {Decoration ? (
                <Decoration.icon size={18} className={cn(Decoration.tone, 'shrink-0')} />
              ) : (
                <span className="w-[18px] shrink-0" />
              )}
              <span className="flex-1 truncate text-ink">{r[labelKey] || '—'}</span>
              <div className="hidden sm:block w-40 h-2 rounded-full bg-surface-2 overflow-hidden">
                <div
                  className="h-full bg-accent rounded-full"
                  style={{ width: `${pct}%` }}
                />
              </div>
              <span className="w-32 text-right font-semibold text-ink tabular-nums">
                {formatCell(value, 'currency')}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
