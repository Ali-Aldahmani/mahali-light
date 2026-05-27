import { useState } from 'react';
import { Play, ChevronDown } from 'lucide-react';
import Button from '../ui/Button.jsx';
import DiskUsageBar from './DiskUsageBar.jsx';
import DestinationStatusBadge from './DestinationStatusBadge.jsx';
import { useAuthStore } from '../../store/authStore.js';
import { timeAgo, formatDateTime } from '../../utils/format.js';
import { formatBytes } from './DiskUsageBar.jsx';

function nextScheduleTime(settings) {
  if (!settings) return null;
  const now = new Date();
  const candidates = [];
  // 6h marks at 00, 06, 12, 18.
  if (settings.schedule_6h_enabled) {
    for (const h of [0, 6, 12, 18]) {
      const c = new Date(now);
      c.setHours(h, 0, 0, 0);
      if (c <= now) c.setDate(c.getDate() + 1);
      candidates.push({ label: '6-hourly DB', time: c });
    }
  }
  if (settings.schedule_nightly_enabled) {
    const c = new Date(now);
    c.setHours(2, 0, 0, 0);
    if (c <= now) c.setDate(c.getDate() + 1);
    candidates.push({ label: 'Nightly full', time: c });
  }
  if (settings.schedule_weekly_enabled) {
    const c = new Date(now);
    c.setHours(3, 0, 0, 0);
    const daysUntilSunday = (7 - c.getDay()) % 7 || 7;
    c.setDate(c.getDate() + daysUntilSunday);
    candidates.push({ label: 'Weekly full', time: c });
  }
  if (!candidates.length) return null;
  candidates.sort((a, b) => a.time - b.time);
  return candidates[0];
}

function formatCountdown(from) {
  if (!from) return '—';
  const diff = from.getTime() - Date.now();
  if (diff <= 0) return 'now';
  const h = Math.floor(diff / (1000 * 60 * 60));
  const m = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
  return `${h}h ${m}m`;
}

export default function BackupStatusCard({
  lastJob,
  diskUsage,
  destinations,
  settings,
  onRunBackup,
  isRunning = false,
}) {
  const role = useAuthStore((s) => s.user?.role);
  const hasPerm = useAuthStore((s) => s.hasPermission);
  const canRun = role === 'Admin' || hasPerm('backup.run_manual');

  const [menuOpen, setMenuOpen] = useState(false);
  const next = nextScheduleTime(settings);

  const completed = lastJob && lastJob.status === 'completed';
  return (
    <div className="card p-5 space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-ink">Backup status</h2>
          <p className="text-xs text-ink-muted">
            Live snapshot of your last and next scheduled backup.
          </p>
        </div>
        {canRun && (
          <div className="relative">
            <Button onClick={() => setMenuOpen((v) => !v)} disabled={isRunning}>
              <Play size={14} />
              {isRunning ? 'Running…' : 'Run manual backup'}
              <ChevronDown size={14} className="opacity-70" />
            </Button>
            {menuOpen && (
              <>
                <div
                  className="fixed inset-0 z-20"
                  onClick={() => setMenuOpen(false)}
                />
                <div className="absolute right-0 top-full z-30 mt-2 w-52 card overflow-hidden">
                  <button
                    type="button"
                    onClick={() => {
                      setMenuOpen(false);
                      onRunBackup?.('full');
                    }}
                    className="block w-full px-4 py-2 text-left text-sm hover:bg-surface-2"
                  >
                    Full backup
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setMenuOpen(false);
                      onRunBackup?.('db_only');
                    }}
                    className="block w-full px-4 py-2 text-left text-sm hover:bg-surface-2"
                  >
                    Database only
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="rounded-card border border-border bg-surface-2/40 p-4">
          <p className="text-xs uppercase tracking-wide text-ink-muted">
            Last backup
          </p>
          {lastJob ? (
            <>
              <p className="mt-1 text-sm font-semibold text-ink">
                {formatDateTime(lastJob.started_at)} ·{' '}
                <span
                  className={
                    completed
                      ? 'text-success'
                      : lastJob.status === 'failed'
                        ? 'text-error'
                        : 'text-warning'
                  }
                >
                  {lastJob.status}
                </span>
              </p>
              <p className="mt-1 text-xs text-ink-muted">
                {lastJob.job_number} · {formatBytes(lastJob.size_bytes)} ·{' '}
                {timeAgo(lastJob.started_at)}
              </p>
            </>
          ) : (
            <p className="mt-1 text-sm text-ink-muted">No backups yet.</p>
          )}
        </div>

        <div className="rounded-card border border-border bg-surface-2/40 p-4">
          <p className="text-xs uppercase tracking-wide text-ink-muted">
            Next backup
          </p>
          {next ? (
            <>
              <p className="mt-1 text-sm font-semibold text-ink">
                {next.label} — {formatDateTime(next.time.toISOString())}
              </p>
              <p className="mt-1 text-xs text-ink-muted">
                In {formatCountdown(next.time)}
              </p>
            </>
          ) : (
            <p className="mt-1 text-sm text-ink-muted">No schedules enabled.</p>
          )}
        </div>
      </div>

      <div>
        <p className="mb-2 text-xs uppercase tracking-wide text-ink-muted">
          Destinations
        </p>
        <div className="space-y-1.5">
          {destinations ? (
            <>
              <DestinationStatusBadge destination={destinations.local} />
              <DestinationStatusBadge destination={destinations.nas} />
              <DestinationStatusBadge destination={destinations.usb} />
            </>
          ) : (
            <p className="text-xs text-ink-muted">Checking destinations…</p>
          )}
        </div>
      </div>

      <div>
        <p className="mb-2 text-xs uppercase tracking-wide text-ink-muted">
          Server disk
        </p>
        <DiskUsageBar usage={diskUsage} />
      </div>
    </div>
  );
}
