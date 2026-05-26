import { cn } from '../../utils/cn.js';
import { formatCurrency, formatQty } from '../../utils/format.js';

const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// 12-row monthly plan with peak-month highlighting and a bold totals row.
// `plan` is an array of { month, recommended_qty, estimated_cost, basis } from
// forecastService.getAnnualPlanForVariant. Peak months come either as an
// explicit `peakMonths` set or are auto-detected (qty > 1.2 × avg).
export default function AnnualPlanTable({ plan = [], peakMonths = null, totals = null }) {
  if (!plan.length) {
    return (
      <div className="rounded-card border border-border bg-surface p-6 text-center text-sm text-ink-muted">
        No plan available yet — try recalculating forecasts.
      </div>
    );
  }
  const avgQty =
    plan.reduce((s, r) => s + Number(r.recommended_qty || 0), 0) / plan.length || 0;
  const autoPeak = new Set(
    plan
      .filter((r) => avgQty > 0 && Number(r.recommended_qty) > avgQty * 1.2)
      .map((r) => r.month),
  );
  const peakSet = peakMonths ? new Set(peakMonths) : autoPeak;

  const sumQty = totals?.qty ?? plan.reduce((s, r) => s + Number(r.recommended_qty || 0), 0);
  const sumCost = totals?.cost ?? plan.reduce((s, r) => s + Number(r.estimated_cost || 0), 0);

  return (
    <div className="rounded-card border border-border bg-surface overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-surface-2 text-ink-muted">
          <tr>
            <th className="px-3 py-2 text-left">Month</th>
            <th className="px-3 py-2 text-right">Recommended Qty</th>
            <th className="px-3 py-2 text-right">Estimated Cost</th>
            <th className="px-3 py-2 text-left">Basis</th>
            <th className="px-3 py-2 text-left">Peak?</th>
          </tr>
        </thead>
        <tbody>
          {plan.map((r) => {
            const isPeak = peakSet.has(r.month);
            return (
              <tr
                key={r.month}
                className={cn(
                  'border-t border-border',
                  isPeak && 'bg-accent-light',
                )}
              >
                <td className="px-3 py-2 font-medium">{MONTH[r.month - 1]}</td>
                <td className="px-3 py-2 text-right">{formatQty(r.recommended_qty)}</td>
                <td className="px-3 py-2 text-right">{formatCurrency(r.estimated_cost)}</td>
                <td className="px-3 py-2 text-ink-muted text-xs">{r.basis || 'historical'}</td>
                <td className="px-3 py-2">
                  {isPeak ? (
                    <span className="inline-flex items-center rounded-full bg-accent px-2 py-0.5 text-xs font-semibold text-white">
                      Peak
                    </span>
                  ) : (
                    <span className="text-ink-muted text-xs">—</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
        <tfoot className="bg-surface-2 font-semibold">
          <tr>
            <td className="px-3 py-2">Annual total</td>
            <td className="px-3 py-2 text-right">{formatQty(sumQty)}</td>
            <td className="px-3 py-2 text-right">{formatCurrency(sumCost)}</td>
            <td colSpan={2} />
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
