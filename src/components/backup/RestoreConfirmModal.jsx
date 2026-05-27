import { useState, useEffect } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import Modal from '../ui/Modal.jsx';
import Button from '../ui/Button.jsx';
import { formatDateTime } from '../../utils/format.js';
import { formatBytes } from './DiskUsageBar.jsx';

export default function RestoreConfirmModal({
  open,
  job,
  onCancel,
  onConfirm,
}) {
  const [text, setText] = useState('');
  useEffect(() => {
    if (open) setText('');
  }, [open]);

  if (!job) return null;
  const enabled = text.trim().toUpperCase() === 'RESTORE';

  return (
    <Modal
      open={open}
      onClose={onCancel}
      title={
        <span className="flex items-center gap-2 text-error">
          <AlertTriangle size={18} />
          Restore system backup
        </span>
      }
      subtitle="This action cannot be undone."
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            variant="danger"
            disabled={!enabled}
            onClick={() => onConfirm?.(job)}
          >
            <RefreshCw size={14} />
            Confirm restore
          </Button>
        </>
      }
    >
      <div className="space-y-4 text-sm">
        <div className="rounded-card border border-border bg-surface-2/40 p-3">
          <p className="font-semibold text-ink">{job.job_number}</p>
          <p className="text-xs text-ink-muted">
            {formatDateTime(job.started_at)} ·{' '}
            {job.type === 'full' ? 'Full (DB + uploads)' : 'Database only'} ·{' '}
            {formatBytes(job.size_bytes)}
          </p>
        </div>

        <ul className="space-y-2 rounded-card border border-error-light bg-error-light/30 p-3 text-error">
          <li className="flex gap-2">
            <span>•</span>
            <span>Replaces ALL current data with the contents of this backup.</span>
          </li>
          <li className="flex gap-2">
            <span>•</span>
            <span>All users will be warned 2 minutes before restore begins.</span>
          </li>
          <li className="flex gap-2">
            <span>•</span>
            <span>The server will restart. Active sessions will be disconnected.</span>
          </li>
          <li className="flex gap-2">
            <span>•</span>
            <span>Restoring cannot be undone.</span>
          </li>
        </ul>

        <div>
          <label className="mb-1 block text-xs font-medium text-ink-muted">
            Type <span className="font-bold text-error">RESTORE</span> to confirm
          </label>
          <input
            type="text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="RESTORE"
            className="w-full rounded-input border border-border bg-surface px-3 py-2 text-sm focus:border-error focus:outline-none"
            autoFocus
          />
        </div>
      </div>
    </Modal>
  );
}
