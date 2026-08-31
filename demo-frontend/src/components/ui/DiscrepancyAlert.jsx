import { AlertTriangle, CheckCircle2 } from 'lucide-react';
import { formatCurrency } from '../../utils/format.js';
import { cn } from '../../utils/cn.js';

// Visualisation for cash-count discrepancies. The amount is signed:
//   > 0 → overage  (counted more than expected)
//   < 0 → shortage (counted less than expected)
export default function DiscrepancyAlert({
  expected = 0,
  counted = 0,
  className = '',
  tolerance = 10,
}) {
  const exp = Number(expected || 0);
  const cnt = Number(counted || 0);
  const diff = round(cnt - exp);
  const absDiff = Math.abs(diff);
  const isZero = absDiff < 0.01;
  const overTolerance = absDiff > Number(tolerance || 0);
  const percent = exp !== 0 ? (absDiff / Math.abs(exp)) * 100 : 0;

  if (isZero) {
    return (
      <div
        className={cn(
          'flex items-center gap-3 rounded-card border border-success/30 bg-success-light px-4 py-3 text-success',
          className,
        )}
      >
        <CheckCircle2 className="h-5 w-5" />
        <div>
          <div className="text-sm font-semibold">Balanced</div>
          <div className="text-xs">Counted cash matches the expected balance.</div>
        </div>
      </div>
    );
  }

  const tone = overTolerance
    ? 'border-error/30 bg-error-light text-error'
    : diff > 0
      ? 'border-warning/30 bg-warning-light text-warning'
      : 'border-error/30 bg-error-light text-error';

  return (
    <div
      className={cn(
        'flex items-center gap-3 rounded-card border px-4 py-3',
        tone,
        className,
      )}
    >
      <AlertTriangle className="h-5 w-5" />
      <div className="text-sm">
        <div className="font-semibold">
          {diff > 0 ? 'Overage' : 'Shortage'} {formatCurrency(absDiff)}
        </div>
        <div className="text-xs">
          Expected {formatCurrency(exp)} · Counted {formatCurrency(cnt)}
          {percent > 0 && <> · {percent.toFixed(2)}%</>}
          {overTolerance && (
            <span className="ml-2 font-semibold">
              Above tolerance ({formatCurrency(tolerance)}). Manager approval required.
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function round(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}
