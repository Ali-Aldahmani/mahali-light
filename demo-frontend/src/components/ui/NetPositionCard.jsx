import { TrendingUp, TrendingDown } from 'lucide-react';
import { formatCurrency } from '../../utils/format.js';

// Large summary card showing the assets vs liabilities breakdown.
//   { cash, banks, receivables, payables }
export default function NetPositionCard({
  cash = 0,
  banks = 0,
  receivables = 0,
  payables = 0,
}) {
  const totalAssets = round(Number(cash) + Number(banks) + Number(receivables));
  const net = round(totalAssets - Number(payables));
  const positive = net >= 0;

  return (
    <div className="rounded-card border border-border bg-surface p-5 shadow-sm">
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold text-ink">
          Net financial position
        </div>
        {positive ? (
          <span className="inline-flex items-center gap-1 text-success text-xs font-medium">
            <TrendingUp className="h-3 w-3" />
            Positive
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 text-error text-xs font-medium">
            <TrendingDown className="h-3 w-3" />
            Negative
          </span>
        )}
      </div>

      <div className="mt-4 space-y-2 text-sm">
        <Row label="Cash in drawer" value={cash} />
        <Row label="Banks" value={banks} />
        <Row label="Receivables" value={receivables} />
        <div className="border-t border-border pt-2 mt-2 flex justify-between font-semibold text-ink">
          <span>Total assets</span>
          <span>{formatCurrency(totalAssets)}</span>
        </div>
        <Row label="Supplier payables" value={payables} tone="negative" />
        <div className="border-t border-border pt-3 mt-2 flex justify-between text-lg font-semibold">
          <span>Net position</span>
          <span className={positive ? 'text-success' : 'text-error'}>
            {formatCurrency(net)}
          </span>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value, tone }) {
  return (
    <div className="flex justify-between text-ink-muted">
      <span>{label}</span>
      <span className={tone === 'negative' ? 'text-error' : 'text-ink'}>
        {formatCurrency(Number(value || 0))}
      </span>
    </div>
  );
}

function round(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}
