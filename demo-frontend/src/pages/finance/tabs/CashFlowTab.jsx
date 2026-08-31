import { useEffect, useState } from 'react';
import PeriodSelector, { getQuickRange } from '../../../components/ui/PeriodSelector.jsx';
import CashFlowTable from '../../../components/ui/CashFlowTable.jsx';
import Spinner from '../../../components/ui/Spinner.jsx';
import EmptyState from '../../../components/ui/EmptyState.jsx';
import { getCashFlow } from '../../../services/financeService.js';

export default function CashFlowTab() {
  const [range, setRange] = useState(() => getQuickRange('this_month'));
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!range?.startDate || !range?.endDate) return;
    let cancelled = false;
    setLoading(true);
    getCashFlow({ startDate: range.startDate, endDate: range.endDate })
      .then((r) => {
        if (!cancelled) {
          setData(r);
          setError(null);
        }
      })
      .catch((err) => {
        if (!cancelled) setError(err?.message || 'Failed to load cash flow.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [range]);

  return (
    <div className="space-y-4">
      <div className="rounded-card border border-border bg-surface p-3">
        <PeriodSelector
          startDate={range?.startDate}
          endDate={range?.endDate}
          onChange={(next) => setRange((prev) => ({ ...prev, ...next }))}
        />
      </div>
      {loading && (
        <div className="flex items-center justify-center py-12">
          <Spinner />
        </div>
      )}
      {error && !loading && (
        <EmptyState title="Could not load cash flow" description={error} />
      )}
      {data && !loading && <CashFlowTable data={data} />}
    </div>
  );
}
