import { Link } from 'react-router-dom';
import { Crown, Medal, Trophy } from 'lucide-react';
import { formatCurrency } from '../../utils/format.js';

const MEDALS = {
  1: { Icon: Crown, color: 'text-amber-500' },
  2: { Icon: Trophy, color: 'text-zinc-500' },
  3: { Icon: Medal, color: 'text-orange-500' },
};

// Ranked spend leaderboard. Top 3 get medal icons. Rows link to the customer
// profile for quick drill-down from the analytics page.
export default function CustomerLeaderboard({
  rows = [],
  emptyText = 'No customer activity in this period.',
}) {
  if (!rows.length) {
    return (
      <div className="rounded-card border border-border bg-surface p-6 text-center text-sm text-ink-muted">
        {emptyText}
      </div>
    );
  }
  return (
    <div className="rounded-card border border-border bg-surface overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-surface-2 text-ink-muted">
          <tr>
            <th className="px-3 py-2 text-left w-10">#</th>
            <th className="px-3 py-2 text-left">Customer</th>
            <th className="px-3 py-2 text-right">Spend</th>
            <th className="px-3 py-2 text-right">Visits</th>
            <th className="px-3 py-2 text-right">AOV</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const medal = MEDALS[r.rank];
            return (
              <tr key={r.customer_id} className="border-t border-border">
                <td className="px-3 py-2">
                  {medal ? (
                    <medal.Icon className={`h-5 w-5 ${medal.color}`} />
                  ) : (
                    <span className="text-ink-muted">{r.rank}</span>
                  )}
                </td>
                <td className="px-3 py-2">
                  <Link
                    to={`/customers/${r.customer_id}`}
                    className="font-medium text-ink hover:text-accent"
                  >
                    {r.customer_name}
                  </Link>
                  {r.phone && (
                    <div className="text-xs text-ink-muted">{r.phone}</div>
                  )}
                </td>
                <td className="px-3 py-2 text-right">
                  {formatCurrency(r.total_spent)}
                </td>
                <td className="px-3 py-2 text-right">{r.invoice_count}</td>
                <td className="px-3 py-2 text-right">
                  {formatCurrency(r.avg_order_value)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
