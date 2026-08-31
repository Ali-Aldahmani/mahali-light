import { CircleCheck } from 'lucide-react';
import Money from './Money.jsx';

// Visual reminder for cash overpayment. Renders a friendly green callout
// with the amount of change due. Returns null when the cashier hasn't yet
// overpaid (so it stays out of the way during normal flow).
export default function ChangeCalculator({ tendered, due, className = '' }) {
  const t = Number(tendered || 0);
  const d = Number(due || 0);
  const change = Math.round((t - d) * 100) / 100;
  if (change <= 0.001) return null;
  return (
    <div
      className={`rounded-card border border-success/20 bg-success-light px-3 py-2 flex items-center justify-between ${className}`}
    >
      <span className="inline-flex items-center gap-2 text-sm font-medium text-success">
        <CircleCheck className="h-4 w-4" />
        Change due
      </span>
      <span className="text-lg font-semibold text-success">
        <Money value={change} />
      </span>
    </div>
  );
}
