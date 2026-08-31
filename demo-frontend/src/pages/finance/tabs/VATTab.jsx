import { useEffect, useMemo, useState } from 'react';
import Button from '../../../components/ui/Button.jsx';
import VATSummaryCard from '../../../components/ui/VATSummaryCard.jsx';
import Spinner from '../../../components/ui/Spinner.jsx';
import EmptyState from '../../../components/ui/EmptyState.jsx';
import { getVATReport } from '../../../services/financeService.js';
import { useAuthStore } from '../../../store/authStore.js';

// UAE quarterly cycle. Quarter 1 = Jan–Mar etc.
function quarterRange(year, q) {
  const startMonth = q * 3;
  return {
    startDate: new Date(Date.UTC(year, startMonth, 1)).toISOString().slice(0, 10),
    endDate: new Date(Date.UTC(year, startMonth + 3, 0)).toISOString().slice(0, 10),
  };
}

export default function VATTab() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [quarter, setQuarter] = useState(Math.floor(now.getMonth() / 3));
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const range = useMemo(() => quarterRange(year, quarter), [year, quarter]);

  // Pull TRN from auth store (store settings get cached there at boot).
  const trn = useAuthStore((s) => s.storeSettings?.trn) || null;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getVATReport({ startDate: range.startDate, endDate: range.endDate })
      .then((r) => {
        if (!cancelled) {
          setData(r);
          setError(null);
        }
      })
      .catch((err) => {
        if (!cancelled) setError(err?.message || 'Failed to load VAT.');
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
      <div className="rounded-card border border-border bg-surface p-3 flex flex-wrap items-center gap-3">
        <div className="flex gap-1.5">
          {[0, 1, 2, 3].map((q) => (
            <Button
              key={q}
              size="sm"
              variant={q === quarter ? 'primary' : 'secondary'}
              onClick={() => setQuarter(q)}
            >
              Q{q + 1}
            </Button>
          ))}
        </div>
        <select
          value={year}
          onChange={(e) => setYear(Number(e.target.value))}
          className="h-8 px-2 rounded-md border border-border bg-surface text-sm"
        >
          {[year - 1, year, year + 1].map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
      </div>

      {loading && (
        <div className="flex items-center justify-center py-12">
          <Spinner />
        </div>
      )}
      {error && !loading && (
        <EmptyState title="Could not load VAT report" description={error} />
      )}
      {data && !loading && <VATSummaryCard data={data} trn={trn} />}
    </div>
  );
}
