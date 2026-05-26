import { useEffect, useState } from 'react';
import PeriodSelector, { getQuickRange } from '../../../components/ui/PeriodSelector.jsx';
import PLStatementTable from '../../../components/ui/PLStatementTable.jsx';
import Button from '../../../components/ui/Button.jsx';
import Spinner from '../../../components/ui/Spinner.jsx';
import EmptyState from '../../../components/ui/EmptyState.jsx';
import { getProfitAndLoss } from '../../../services/financeService.js';

export default function PLTab() {
  const [range, setRange] = useState(() => getQuickRange('this_month'));
  const [compare, setCompare] = useState(false);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!range?.startDate || !range?.endDate) return;
    let cancelled = false;
    setLoading(true);
    getProfitAndLoss({
      startDate: range.startDate,
      endDate: range.endDate,
      compare,
    })
      .then((r) => {
        if (!cancelled) {
          setData(r);
          setError(null);
        }
      })
      .catch((err) => {
        if (!cancelled) setError(err?.message || 'Failed to load P&L.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [range, compare]);

  return (
    <div className="space-y-4">
      <div className="rounded-card border border-border bg-surface p-3 flex flex-wrap items-center gap-3">
        <PeriodSelector
          startDate={range?.startDate}
          endDate={range?.endDate}
          onChange={(next) => setRange((prev) => ({ ...prev, ...next }))}
        />
        <label className="ml-auto text-sm flex items-center gap-2">
          <input
            type="checkbox"
            checked={compare}
            onChange={(e) => setCompare(e.target.checked)}
          />
          Compare vs previous period
        </label>
      </div>
      {loading && (
        <div className="flex items-center justify-center py-12">
          <Spinner />
        </div>
      )}
      {error && !loading && (
        <EmptyState title="Could not load P&L" description={error} />
      )}
      {data && !loading && <PLStatementTable data={data} />}
    </div>
  );
}
