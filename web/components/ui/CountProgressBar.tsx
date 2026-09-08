// X-of-Y progress bar that changes color as a count progresses.
// 0-33%   accent (orange)
// 34-66%  warning (yellow)
// 67-99%  success (green)
// 100%    deep success
export default function CountProgressBar({
  counted = 0,
  total = 0,
  showLabel = true,
}) {
  const safeTotal = Math.max(0, Number(total) || 0);
  const safeCounted = Math.min(Math.max(0, Number(counted) || 0), safeTotal);
  const pct = safeTotal === 0 ? 0 : Math.round((safeCounted / safeTotal) * 100);

  let barColor = 'bg-accent';
  if (pct >= 100) barColor = 'bg-success';
  else if (pct >= 67) barColor = 'bg-success';
  else if (pct >= 34) barColor = 'bg-warning';

  return (
    <div className="space-y-1">
      {showLabel && (
        <div className="flex items-center justify-between text-xs text-ink-muted">
          <span>
            {safeCounted} of {safeTotal} counted
          </span>
          <span className="font-medium text-ink">{pct}%</span>
        </div>
      )}
      <div className="h-2 rounded-full bg-surface-2 overflow-hidden">
        <div
          className={`h-full ${barColor} transition-all duration-300`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
