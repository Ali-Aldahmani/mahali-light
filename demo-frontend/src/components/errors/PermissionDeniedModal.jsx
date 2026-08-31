import { Lock } from 'lucide-react';
import Modal from '../ui/Modal.jsx';
import Button from '../ui/Button.jsx';
import { useUiErrorStore } from '../../store/uiErrorStore.js';

export default function PermissionDeniedModal() {
  const modal = useUiErrorStore((s) => s.permissionModal);
  const hide = useUiErrorStore((s) => s.hidePermissionDenied);

  return (
    <Modal
      open={Boolean(modal)}
      onClose={hide}
      title={
        <span className="flex items-center gap-2">
          <Lock size={18} className="text-warning" />
          Access denied
        </span>
      }
      footer={<Button onClick={hide}>OK</Button>}
    >
      <p className="text-sm text-ink-muted">
        You don&apos;t have permission to {modal?.action || 'perform this action'}.
      </p>
      {modal?.permission && (
        <p className="mt-2 text-xs text-ink-muted">
          Required permission:{' '}
          <code className="rounded bg-surface-2 px-1 py-0.5">{modal.permission}</code>
        </p>
      )}
      <p className="mt-3 text-sm text-ink-muted">
        Contact your manager if you need access.
      </p>
    </Modal>
  );
}
