import { Crown, Trophy, Medal } from 'lucide-react';
import { cn } from '../../utils/cn.js';
import { formatCurrency } from '../../utils/format.js';

const MEDALS = {
  1: { Icon: Crown, color: 'text-amber-500' },
  2: { Icon: Trophy, color: 'text-zinc-500' },
  3: { Icon: Medal, color: 'text-orange-500' },
};

function Initials({ name }) {
  if (!name) return null;
  const parts = String(name).trim().split(/\s+/);
  const txt = (parts[0]?.[0] || '?') + (parts[1]?.[0] || '');
  return (
    <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-accent-light text-accent text-xs font-semibold">
      {txt.toUpperCase()}
    </span>
  );
}

// Employee leaderboard / table. Compact mode renders only name + revenue;
// the verbose table shown on the Employees tab adds discounts, returns,
// collections and attendance rate.
export default function EmployeePerformanceTable({ rows = [], compact = false, topRevenue = 0 }) {
  if (!rows.length) {
    return (
      <div className="rounded-card border border-border bg-surface p-6 text-center text-sm text-ink-muted">
        No employee activity in this period.
      </div>
    );
  }
  const maxRevenue = topRevenue || Math.max(...rows.map((r) => Number(r.revenue_generated) || 0), 1);
  return (
    <div className="rounded-card border border-border bg-surface overflow-x-auto">
      <table className={cn('w-full text-sm', !compact && 'min-w-[560px]')}>
        <thead className="bg-surface-2 text-ink-muted">
          <tr>
            <th className="px-3 py-2 text-left w-10">#</th>
            <th className="px-3 py-2 text-left">Employee</th>
            <th className="px-3 py-2 text-right">Invoices</th>
            <th className="px-3 py-2 text-right">Revenue</th>
            {!compact && <th className="px-3 py-2 text-right">Avg. value</th>}
            {!compact && <th className="px-3 py-2 text-right">Discounts</th>}
            {!compact && <th className="px-3 py-2 text-right">Returns</th>}
            {!compact && <th className="px-3 py-2 text-right">Attendance</th>}
            {!compact && <th className="px-3 py-2 text-right w-32">Achievement</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const medal = MEDALS[r.rank];
            const pct = maxRevenue > 0 ? Math.min(100, (Number(r.revenue_generated) / maxRevenue) * 100) : 0;
            return (
              <tr key={r.user_id} className="border-t border-border">
                <td className="px-3 py-2">
                  {medal ? (
                    <medal.Icon className={`h-5 w-5 ${medal.color}`} />
                  ) : (
                    <span className="text-ink-muted">{r.rank}</span>
                  )}
                </td>
                <td className="px-3 py-2">
                  <div className="flex items-center gap-2">
                    <Initials name={r.employee_name} />
                    <div>
                      <div className="font-medium text-ink">{r.employee_name}</div>
                    </div>
                  </div>
                </td>
                <td className="px-3 py-2 text-right">{r.invoices_created}</td>
                <td className="px-3 py-2 text-right font-semibold">
                  {formatCurrency(r.revenue_generated)}
                </td>
                {!compact && (
                  <td className="px-3 py-2 text-right">
                    {formatCurrency(r.avg_invoice_value)}
                  </td>
                )}
                {!compact && (
                  <td className="px-3 py-2 text-right text-xs text-ink-muted">
                    {Number(r.discount_rate_pct || 0).toFixed(1)}%
                  </td>
                )}
                {!compact && (
                  <td className="px-3 py-2 text-right text-xs text-ink-muted">
                    {r.return_request_count}
                  </td>
                )}
                {!compact && (
                  <td className="px-3 py-2 text-right">
                    <span
                      className={cn(
                        'inline-flex items-center rounded-full px-2 py-0.5 text-xs',
                        r.attendance_rate_pct == null
                          ? 'bg-surface-2 text-ink-muted'
                          : Number(r.attendance_rate_pct) >= 95
                            ? 'bg-success-light text-success'
                            : Number(r.attendance_rate_pct) >= 80
                              ? 'bg-amber-100 text-amber-700'
                              : 'bg-error-light text-error',
                      )}
                    >
                      {r.attendance_rate_pct != null
                        ? `${Number(r.attendance_rate_pct).toFixed(0)}%`
                        : '—'}
                    </span>
                  </td>
                )}
                {!compact && (
                  <td className="px-3 py-2">
                    <div className="h-2 w-full rounded-full bg-surface-2 overflow-hidden">
                      <div
                        className="h-full bg-accent"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <div className="mt-1 text-[10px] text-ink-muted text-right">
                      {pct.toFixed(0)}%
                    </div>
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
