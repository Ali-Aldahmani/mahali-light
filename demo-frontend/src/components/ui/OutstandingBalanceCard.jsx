import { Wallet } from 'lucide-react';
import Button from './Button.jsx';
import { formatCurrency } from '../../utils/format.js';

// Prominent balance card used on the customer profile header and the
// receivables panel. Renders nothing when balance is zero.
export default function OutstandingBalanceCard({
  balance,
  limit = 0,
  onCollect,
  canCollect = false,
}) {
  const b = Number(balance || 0);
  if (b <= 0.001) {
    return (
      <div className="rounded-card border border-border bg-success-light p-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 inline-flex items-center justify-center rounded-md bg-success/10 text-success">
            <Wallet size={18} />
          </div>
          <div>
            <div className="text-xs text-ink-muted">Outstanding balance</div>
            <div className="text-base font-semibold text-success">
              No balance owed
            </div>
          </div>
        </div>
      </div>
    );
  }

  const overLimit = limit > 0 && b > Number(limit) + 0.001;
  const tone = overLimit ? 'bg-error-light text-error' : 'bg-accent-light text-accent';

  return (
    <div
      className={`rounded-card border border-border p-4 flex items-center justify-between ${tone}`}
    >
      <div className="flex items-center gap-3">
        <div className="h-10 w-10 inline-flex items-center justify-center rounded-md bg-surface/40">
          <Wallet size={18} />
        </div>
        <div>
          <div className="text-xs">Outstanding balance</div>
          <div className="text-lg font-semibold">{formatCurrency(b)}</div>
          {limit > 0 && (
            <div className="text-xs">
              Limit: {formatCurrency(limit)}
              {overLimit && <span className="ml-2 font-semibold">EXCEEDED</span>}
            </div>
          )}
        </div>
      </div>
      {canCollect && (
        <Button variant="primary" onClick={onCollect}>
          Collect payment
        </Button>
      )}
    </div>
  );
}
