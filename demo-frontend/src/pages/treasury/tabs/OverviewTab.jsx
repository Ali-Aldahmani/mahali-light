import { useEffect, useState } from 'react';
import {
  Banknote,
  Building2,
  ArrowDownToLine,
  ArrowUpFromLine,
  Receipt,
  UserPlus,
  Truck,
  PiggyBank,
} from 'lucide-react';
import TreasuryCard from '../../../components/ui/TreasuryCard.jsx';
import NetPositionCard from '../../../components/ui/NetPositionCard.jsx';
import TransactionDirectionBadge from '../../../components/ui/TransactionDirectionBadge.jsx';
import CashTransactionTypeBadge from '../../../components/ui/CashTransactionTypeBadge.jsx';
import { getTreasurySummary } from '../../../services/treasuryService.js';
import { onTreasuryEvent } from '../../../store/socketStore.js';
import { formatCurrency, timeAgo } from '../../../utils/format.js';
import EmptyState from '../../../components/ui/EmptyState.jsx';
import Spinner from '../../../components/ui/Spinner.jsx';

export default function OverviewTab({ onJumpTab }) {
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);

  async function load() {
    try {
      const data = await getTreasurySummary();
      setSummary(data);
    } catch (_e) {
      // ignore
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  useEffect(
    () =>
      onTreasuryEvent(() => {
        // Re-fetch on any treasury event — the deltas in payload aren't
        // enough to keep the full snapshot (e.g. recent feed) accurate.
        load();
      }),
    [],
  );

  if (loading || !summary) {
    return (
      <div className="card p-12 flex items-center justify-center">
        <Spinner className="text-accent" />
      </div>
    );
  }

  const todayNet = summary.today.moneyIn - summary.today.moneyOut;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <TreasuryCard
          label="Cash in drawer"
          value={summary.cash.balance}
          hint={summary.cash.status === 'open' ? 'Drawer open' : 'Drawer closed'}
          Icon={Banknote}
          tone="cash"
          onClick={() => onJumpTab?.('cash')}
        />
        <TreasuryCard
          label="Total in banks"
          value={summary.banks.total}
          hint={`${summary.banks.accounts.length} account${summary.banks.accounts.length === 1 ? '' : 's'}`}
          Icon={Building2}
          tone="bank"
          onClick={() => onJumpTab?.('banks')}
        />
        <TreasuryCard
          label="Customer receivables"
          value={summary.receivables}
          Icon={UserPlus}
          tone="receivables"
        />
        <TreasuryCard
          label="Supplier payables"
          value={summary.payables}
          Icon={Truck}
          tone="payables"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2">
          <NetPositionCard
            cash={summary.cash.balance}
            banks={summary.banks.total}
            receivables={summary.receivables}
            payables={summary.payables}
          />
        </div>

        <div className="rounded-card border border-border bg-surface p-5 shadow-sm">
          <div className="text-sm font-semibold text-ink">Today's money flow</div>
          <div className="mt-4 grid grid-cols-2 gap-3">
            <div className="rounded-card border border-success/30 bg-success-light p-3">
              <div className="text-xs text-success/80">Money in</div>
              <div className="text-lg font-semibold text-success mt-0.5">
                +{formatCurrency(summary.today.moneyIn)}
              </div>
              <div className="text-[11px] text-success/80 mt-1">
                {summary.today.inCount} transaction{summary.today.inCount === 1 ? '' : 's'}
              </div>
            </div>
            <div className="rounded-card border border-error/30 bg-error-light p-3">
              <div className="text-xs text-error/80">Money out</div>
              <div className="text-lg font-semibold text-error mt-0.5">
                −{formatCurrency(summary.today.moneyOut)}
              </div>
              <div className="text-[11px] text-error/80 mt-1">
                {summary.today.outCount} transaction{summary.today.outCount === 1 ? '' : 's'}
              </div>
            </div>
          </div>
          <div className="mt-3 flex items-center justify-between text-sm">
            <span className="text-ink-muted">Net today</span>
            <span
              className={
                todayNet >= 0
                  ? 'text-success font-semibold'
                  : 'text-error font-semibold'
              }
            >
              {todayNet >= 0 ? '+' : '−'}
              {formatCurrency(Math.abs(todayNet))}
            </span>
          </div>
        </div>
      </div>

      <div className="card overflow-hidden">
        <div className="px-5 py-4 border-b border-border flex items-center justify-between">
          <div>
            <div className="text-sm font-semibold text-ink">Recent activity</div>
            <div className="text-xs text-ink-muted">
              Latest cash and bank transactions across the store.
            </div>
          </div>
        </div>
        {summary.recent.length === 0 ? (
          <EmptyState
            title="No transactions yet"
            description="Recorded payments and movements will appear here."
            icon={<Receipt />}
            className="py-12"
          />
        ) : (
          <ul className="divide-y divide-border">
            {summary.recent.map((r) => (
              <li
                key={`${r.source}-${r.id}`}
                className="px-5 py-3 flex items-center gap-4"
              >
                <div className="shrink-0">
                  <CashTransactionTypeBadge type={r.transactionType} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-ink truncate">
                    {r.source === 'cash' ? 'Cash drawer' : `${r.bankName || 'Bank'}`}
                    {r.notes ? ` · ${r.notes}` : ''}
                  </div>
                  <div className="text-xs text-ink-muted">
                    {timeAgo(r.timestamp)} ·{' '}
                    {r.employeeUsername || 'system'}
                  </div>
                </div>
                <TransactionDirectionBadge
                  direction={r.direction}
                  amount={r.amount}
                />
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
