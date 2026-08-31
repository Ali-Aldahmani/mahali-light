import { Link } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { AlertTriangle, Receipt, Boxes, ArrowRight } from 'lucide-react';
import { listReorderAlerts } from '../../services/reorderService.js';
import { useBillStore } from '../../store/billStore.js';
import { formatCurrency, formatQty } from '../../utils/format.js';

// Compact panel that fuses upcoming bills + reorder alerts into a single
// "needs your attention" card. Each section is hidden if the user lacks
// the related permission so this is safe to render unconditionally.
export default function AlertsPanel() {
  const upcoming = useBillStore((s) => s.upcoming);
  const refreshBills = useBillStore((s) => s.refreshUpcoming);
  const [reorders, setReorders] = useState([]);

  useEffect(() => {
    if (!upcoming) refreshBills().catch(() => {});
  }, [upcoming, refreshBills]);

  useEffect(() => {
    listReorderAlerts('pending')
      .then((res) => setReorders(Array.isArray(res?.data) ? res.data : res || []))
      .catch(() => setReorders([]));
  }, []);

  const billItems = (() => {
    const b = upcoming?.buckets || {};
    return [...(b.overdue || []), ...(b.dueToday || []), ...(b.thisWeek || [])].slice(0, 3);
  })();

  const reorderItems = reorders.slice(0, 3);

  if (!billItems.length && !reorderItems.length) {
    return (
      <div className="rounded-card border border-border bg-surface p-6 text-center text-sm text-ink-muted">
        Nothing needs your attention right now.
      </div>
    );
  }

  return (
    <div className="rounded-card border border-border bg-surface overflow-hidden">
      {reorderItems.length > 0 && (
        <div className="p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <span className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-accent-light text-accent">
                <Boxes className="h-4 w-4" />
              </span>
              <h3 className="font-semibold text-ink">Reorder alerts</h3>
              <span className="rounded-full bg-error-light text-error text-xs px-2">
                {reorders.length}
              </span>
            </div>
            <Link
              to="/analytics?tab=forecasting"
              className="text-xs text-accent inline-flex items-center gap-1"
            >
              View all <ArrowRight className="h-3 w-3" />
            </Link>
          </div>
          <ul className="divide-y divide-border">
            {reorderItems.map((r) => (
              <li key={r.id} className="py-2 flex items-center justify-between">
                <div className="min-w-0">
                  <div className="text-sm font-medium text-ink truncate">
                    {r.product_name || r.variant_name || '—'}
                  </div>
                  <div className="text-xs text-ink-muted">
                    {formatQty(r.current_stock)} in stock · reorder at{' '}
                    {formatQty(r.reorder_point)}
                  </div>
                </div>
                <span className="text-xs font-semibold text-accent ml-2 whitespace-nowrap">
                  +{formatQty(r.recommended_order_qty)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {billItems.length > 0 && (
        <div className="p-4 border-t border-border">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <span className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-amber-100 text-amber-700">
                <Receipt className="h-4 w-4" />
              </span>
              <h3 className="font-semibold text-ink">Upcoming bills</h3>
            </div>
            <Link
              to="/expenses"
              className="text-xs text-accent inline-flex items-center gap-1"
            >
              View all <ArrowRight className="h-3 w-3" />
            </Link>
          </div>
          <ul className="divide-y divide-border">
            {billItems.map((b) => (
              <li key={b.id} className="py-2 flex items-center justify-between">
                <div className="min-w-0">
                  <div className="text-sm font-medium text-ink truncate">
                    {b.bill_name || b.name || 'Bill'}
                  </div>
                  <div className="text-xs text-ink-muted">
                    {b.due_date ? `Due ${new Date(b.due_date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}` : 'Upcoming'}
                  </div>
                </div>
                <span className="text-sm font-semibold text-ink ml-2 whitespace-nowrap">
                  {formatCurrency(b.amount_due || b.amount)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
