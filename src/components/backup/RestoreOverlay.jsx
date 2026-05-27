import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Loader2, ShieldAlert } from 'lucide-react';
import { useBackupStore } from '../../store/backupStore.js';
import { cn } from '../../utils/cn.js';

function useCountdown(target) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!target) return undefined;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [target]);
  if (!target) return 0;
  return Math.max(0, Math.ceil((target - now) / 1000));
}

// Two-stage overlay:
//   1. Pre-restore warning (countdown) — shown on ALL connected PCs.
//   2. Live progress bar during restore.
// Both are dismissible only by the server (via socket events).
export default function RestoreOverlay() {
  const imminent = useBackupStore((s) => s.restoreImminent);
  const progress = useBackupStore((s) => s.restoreProgress);
  const maintenance = useBackupStore((s) => s.maintenance);

  const target = imminent
    ? imminent.startedAt + imminent.startsIn * 1000
    : null;
  const seconds = useCountdown(target);

  // Hide if nothing happening.
  const showWarning = imminent && seconds > 0;
  const showProgress = maintenance?.active || progress;
  if (!showWarning && !showProgress) return null;

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-ink/70 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-card border border-border bg-surface p-6 shadow-pop">
        {showWarning ? (
          <PreRestore seconds={seconds} />
        ) : (
          <LiveProgress progress={progress} />
        )}
      </div>
    </div>,
    document.body,
  );
}

function PreRestore({ seconds }) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 text-warning">
        <ShieldAlert size={22} />
        <h3 className="text-lg font-semibold">System restore in {m > 0 ? `${m}m ` : ''}{s}s</h3>
      </div>
      <p className="text-sm text-ink-muted">
        An administrator is about to restore the database from a backup. Please
        save your work now. The application will reconnect automatically after
        the restore is complete.
      </p>
      <div className="h-2 w-full overflow-hidden rounded-full bg-surface-2">
        <div
          className={cn(
            'h-2 bg-warning transition-all',
          )}
          style={{
            width: `${Math.min(100, 100 - (seconds / 120) * 100)}%`,
          }}
        />
      </div>
    </div>
  );
}

function LiveProgress({ progress }) {
  const percent = Number(progress?.percent || 30);
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 text-accent">
        <Loader2 size={22} className="animate-spin" />
        <h3 className="text-lg font-semibold">System restore in progress</h3>
      </div>
      <p className="text-sm text-ink-muted">
        {progress?.message ||
          'The system is being restored from a backup. Please do not close this window.'}
      </p>
      <div className="h-2 w-full overflow-hidden rounded-full bg-surface-2">
        <div
          className={cn('h-2 bg-accent transition-all')}
          style={{ width: `${Math.min(100, Math.max(2, percent))}%` }}
        />
      </div>
      <p className="text-right text-xs text-ink-muted">{percent}%</p>
    </div>
  );
}
