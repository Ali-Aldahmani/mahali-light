import { cn } from '../../utils/cn.js';

function formatBytes(n) {
  if (n == null) return '—';
  const x = Number(n) || 0;
  if (x < 1024) return `${x} B`;
  if (x < 1024 * 1024) return `${(x / 1024).toFixed(1)} KB`;
  if (x < 1024 * 1024 * 1024) return `${(x / 1024 / 1024).toFixed(1)} MB`;
  if (x < 1024 * 1024 * 1024 * 1024) return `${(x / 1024 / 1024 / 1024).toFixed(2)} GB`;
  return `${(x / 1024 / 1024 / 1024 / 1024).toFixed(2)} TB`;
}

export default function DiskUsageBar({ usage }) {
  if (!usage) {
    return (
      <div className="text-xs text-ink-muted">Checking disk usage…</div>
    );
  }
  const used = Number(usage.usedPercent || 0);
  const tone =
    used >= 85 ? 'bg-error' : used >= 70 ? 'bg-warning' : 'bg-success';
  return (
    <div className="space-y-1.5">
      <div className="h-2 w-full overflow-hidden rounded-full bg-surface-2">
        <div
          className={cn('h-2 transition-all', tone)}
          style={{ width: `${Math.min(100, Math.max(2, used))}%` }}
        />
      </div>
      <div className="flex items-center justify-between text-xs">
        <span className="text-ink-muted">
          {usage.usedPercent != null
            ? `${usage.usedPercent}% used`
            : 'Usage unknown'}
        </span>
        <span className="text-ink-muted">
          {formatBytes(usage.usedBytes)} / {formatBytes(usage.totalBytes)}
          {' · '}
          {formatBytes(usage.freeBytes)} free
        </span>
      </div>
    </div>
  );
}

export { formatBytes };
