import { useEffect, useState } from 'react';
import PeriodSelector from '../../../components/ui/PeriodSelector.jsx';
import BalanceSheetTable from '../../../components/ui/BalanceSheetTable.jsx';
import Spinner from '../../../components/ui/Spinner.jsx';
import EmptyState from '../../../components/ui/EmptyState.jsx';
import { getBalanceSheet } from '../../../services/financeService.js';

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

export default function BalanceSheetTab() {
  const [asOf, setAsOf] = useState(todayIso());
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!asOf) return;
    let cancelled = false;
    setLoading(true);
    getBalanceSheet({ asOfDate: asOf })
      .then((r) => {
        if (!cancelled) {
          setData(r);
          setError(null);
        }
      })
      .catch((err) => {
        if (!cancelled) setError(err?.message || 'Failed to load balance sheet.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [asOf]);

  return (
    <div className="space-y-4">
      <div className="rounded-card border border-border bg-surface p-3">
        <PeriodSelector
          mode="single"
          asOfDate={asOf}
          onChange={(next) => setAsOf(next.asOfDate)}
        />
      </div>
      {loading && (
        <div className="flex items-center justify-center py-12">
          <Spinner />
        </div>
      )}
      {error && !loading && (
        <EmptyState title="Could not load balance sheet" description={error} />
      )}
      {data && !loading && <BalanceSheetTable data={data} />}
    </div>
  );
}
