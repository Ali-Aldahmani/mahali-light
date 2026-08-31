import { AlertTriangle, RefreshCw, Bug } from 'lucide-react';
import Button from '../ui/Button.jsx';
import { useUiErrorStore } from '../../store/uiErrorStore.js';

export default function ErrorFallback({ error, onReset }) {
  const openBugReport = useUiErrorStore((s) => s.openBugReport);

  return (
    <div className="flex min-h-[200px] flex-col items-center justify-center rounded-card border border-border bg-surface p-8 text-center">
      <AlertTriangle size={32} className="text-warning" />
      <h3 className="mt-3 text-base font-semibold text-ink">Something went wrong in this section</h3>
      <p className="mt-1 max-w-md text-sm text-ink-muted">
        The error has been logged automatically. You can reload this section or report a bug.
      </p>
      <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
        <Button variant="secondary" onClick={onReset}>
          <RefreshCw size={14} /> Reload section
        </Button>
        <Button
          variant="primary"
          onClick={() =>
            openBugReport({
              errorCode: 'REACT_BOUNDARY',
              stackTrace: error?.stack,
              whatHappened: error?.message || 'React component error',
            })
          }
        >
          <Bug size={14} /> Report bug
        </Button>
      </div>
    </div>
  );
}
