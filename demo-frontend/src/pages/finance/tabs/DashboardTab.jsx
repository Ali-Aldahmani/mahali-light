import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  TrendingUp,
  TrendingDown,
  DollarSign,
  Wallet,
  Calendar,
  ArrowRight,
} from 'lucide-react';
import FinanceMetricCard from '../../../components/ui/FinanceMetricCard.jsx';
import PLStatementTable from '../../../components/ui/PLStatementTable.jsx';
import BalanceSheetTable from '../../../components/ui/BalanceSheetTable.jsx';
import Spinner from '../../../components/ui/Spinner.jsx';
import EmptyState from '../../../components/ui/EmptyState.jsx';
import Button from '../../../components/ui/Button.jsx';
import {
  getProfitAndLoss,
  getBalanceSheet,
} from '../../../services/financeService.js';
import { useFinanceStore } from '../../../store/financeStore.js';
import { formatCurrency } from '../../../utils/format.js';

function monthStartEnd() {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  return {
    startDate: new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10),
    endDate: new Date(Date.UTC(y, m + 1, 0)).toISOString().slice(0, 10),
  };
}

export default function DashboardTab() {
  const snapshot = useFinanceStore((s) => s.snapshot);
  const refreshSnapshot = useFinanceStore((s) => s.refreshSnapshot);
  const lastError = useFinanceStore((s) => s.lastError);

  const [pl, setPl] = useState(null);
  const [bs, setBs] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const { startDate, endDate } = monthStartEnd();
        const [snap, plResp, bsResp] = await Promise.all([
          refreshSnapshot(true).catch(() => null),
          getProfitAndLoss({ startDate, endDate, compare: false }),
          getBalanceSheet({ asOfDate: endDate }),
        ]);
        if (cancelled) return;
        setPl(plResp);
        setBs(bsResp);
      } catch (err) {
        if (!cancelled) setError(err?.message || 'Failed to load finance data.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [refreshSnapshot]);

  if (loading && !snapshot) {
    return (
      <div className="flex items-center justify-center py-16">
        <Spinner />
      </div>
    );
  }
  if (error && !snapshot) {
    return <EmptyState title="Could not load finance data" description={error} />;
  }
  if (!snapshot) {
    return <EmptyState title="No finance data yet" description={lastError || ''} />;
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <FinanceMetricCard
          label="Revenue MTD"
          value={snapshot.revenue.mtd}
          delta={snapshot.revenue.delta}
          Icon={TrendingUp}
        />
        <FinanceMetricCard
          label="Expenses MTD"
          value={snapshot.expenses.mtd}
          delta={snapshot.expenses.delta}
          invertColor
          Icon={TrendingDown}
        />
        <FinanceMetricCard
          label="Net Profit MTD"
          value={snapshot.netProfit.mtd}
          delta={snapshot.netProfit.delta}
          Icon={DollarSign}
          hint={snapshot.netProfit.mtd >= 0 ? 'Profitable month' : 'In the red'}
        />
        <FinanceMetricCard
          label="VAT Payable"
          value={snapshot.vatPayable}
          hint={
            snapshot.vatDueDate
              ? `Due ${snapshot.vatDueDate} (${snapshot.vatDaysLeft} days)`
              : null
          }
          Icon={Calendar}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div>
          <div className="text-sm font-semibold text-ink mb-2">Profit & Loss snapshot</div>
          <PLStatementTable data={pl} />
        </div>
        <div>
          <div className="flex items-center justify-between mb-2">
            <div className="text-sm font-semibold text-ink">Balance snapshot</div>
            <Link to="/finance?tab=balance-sheet">
              <Button variant="secondary" size="sm" rightIcon={<ArrowRight size={14} />}>
                View full
              </Button>
            </Link>
          </div>
          <BalanceSheetTable data={bs} />

          <div className="mt-4 rounded-card border border-border bg-surface p-4">
            <div className="text-xs uppercase tracking-wide text-ink-muted mb-2">
              Cash position
            </div>
            <div className="flex items-center gap-2 text-sm">
              <Wallet className="h-4 w-4 text-accent" />
              <span>Cash + banks</span>
              <span className="ml-auto font-mono font-semibold">
                {formatCurrency(snapshot.cash)}
              </span>
            </div>
            <div className="flex items-center gap-2 text-sm mt-1">
              <span className="h-4 w-4" />
              <span>Receivables</span>
              <span className="ml-auto font-mono">
                {formatCurrency(snapshot.receivables)}
              </span>
            </div>
            <div className="flex items-center gap-2 text-sm mt-1">
              <span className="h-4 w-4" />
              <span>Payables</span>
              <span className="ml-auto font-mono">
                {formatCurrency(snapshot.payables)}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
