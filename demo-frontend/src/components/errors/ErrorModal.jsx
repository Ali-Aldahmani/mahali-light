import { useState } from 'react';
import { AlertTriangle, ChevronDown, ChevronRight } from 'lucide-react';
import Modal from '../ui/Modal.jsx';
import Button from '../ui/Button.jsx';
import { useUiErrorStore } from '../../store/uiErrorStore.js';

export default function ErrorModal() {
  const payload = useUiErrorStore((s) => s.errorModal);
  const hide = useUiErrorStore((s) => s.hideErrorModal);
  const openBug = useUiErrorStore((s) => s.openBugReport);
  const [showTech, setShowTech] = useState(false);

  if (!payload) return null;

  return (
    <Modal
      open={Boolean(payload)}
      onClose={hide}
      title={
        <span className="flex items-center gap-2 text-error">
          <AlertTriangle size={18} />
          {payload.title || 'Something went wrong'}
        </span>
      }
      size="lg"
      footer={
        <>
          {payload.secondaryAction && (
            <Button variant="secondary" onClick={payload.secondaryAction.onClick}>
              {payload.secondaryAction.label}
            </Button>
          )}
          {payload.showReportBug !== false && (
            <Button
              variant="secondary"
              onClick={() => {
                hide();
                openBug({
                  errorCode: payload.code,
                  whatHappened: payload.message,
                });
              }}
            >
              Report bug
            </Button>
          )}
          <Button onClick={payload.primaryAction?.onClick || hide}>
            {payload.primaryAction?.label || 'OK'}
          </Button>
        </>
      }
    >
      <p className="text-sm text-ink">{payload.message}</p>
      {payload.suggestions?.length > 0 && (
        <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-ink-muted">
          {payload.suggestions.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ul>
      )}
      {(payload.details || payload.code) && (
        <div className="mt-4">
          <button
            type="button"
            className="flex items-center gap-1 text-xs font-medium text-ink-muted"
            onClick={() => setShowTech((v) => !v)}
          >
            {showTech ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            Technical details
          </button>
          {showTech && (
            <pre className="mt-2 max-h-40 overflow-auto rounded-card bg-surface-2 p-2 text-xs text-ink-muted">
              {payload.code}
              {payload.details ? `\n${JSON.stringify(payload.details, null, 2)}` : ''}
            </pre>
          )}
        </div>
      )}
    </Modal>
  );
}
