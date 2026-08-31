import { Download, RefreshCw, HardDrive, Server, Usb } from 'lucide-react';
import Button from '../ui/Button.jsx';
import Badge from '../ui/Badge.jsx';
import { formatDateTime } from '../../utils/format.js';
import { formatBytes } from './DiskUsageBar.jsx';

const STATUS_TONES = {
  completed: 'success',
  partial: 'warning',
  running: 'accent',
  failed: 'error',
};

const DEST_ICON = { local: HardDrive, nas: Server, usb: Usb };

function destinationIcons(destinations = []) {
  const types = ['local', 'nas', 'usb'];
  return types.map((type) => {
    const hit = destinations.find((d) => d.type === type);
    const Icon = DEST_ICON[type];
    const tone = !hit
      ? 'text-ink-muted/40'
      : hit.success
        ? 'text-success'
        : 'text-error';
    return (
      <span
        key={type}
        className={tone}
        title={
          !hit
            ? `${type}: not used`
            : hit.success
              ? `${type}: ${hit.path || 'saved'}`
              : `${type}: ${hit.error || 'failed'}`
        }
      >
        <Icon size={14} />
      </span>
    );
  });
}

function formatDuration(seconds) {
  const s = Number(seconds) || 0;
  if (!s) return '—';
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}m ${r}s`;
}

export default function BackupJobRow({
  job,
  canDownload,
  canRestore,
  onDownload,
  onRestore,
}) {
  if (!job) return null;
  const statusTone = STATUS_TONES[job.status] || 'default';
  return (
    <tr className="border-t border-border">
      <td className="px-3 py-2 align-top">
        <p className="text-sm font-medium text-ink">{job.job_number}</p>
        <p className="text-xs text-ink-muted">
          {job.type === 'full' ? 'Full backup' : 'Database only'} ·{' '}
          {job.triggered_by_username || job.triggered_by}
        </p>
      </td>
      <td className="px-3 py-2 align-top">
        <p className="text-sm text-ink">{formatDateTime(job.started_at)}</p>
        <p className="text-xs text-ink-muted">
          {formatDuration(job.duration_seconds)}
        </p>
      </td>
      <td className="px-3 py-2 align-top text-sm text-ink">
        {formatBytes(job.size_bytes)}
      </td>
      <td className="px-3 py-2 align-top">
        <div className="flex items-center gap-1">{destinationIcons(job.destinations)}</div>
      </td>
      <td className="px-3 py-2 align-top">
        <Badge tone={statusTone}>{job.status}</Badge>
        {job.error_message && (
          <p className="mt-1 max-w-[16rem] truncate text-xs text-ink-muted" title={job.error_message}>
            {job.error_message}
          </p>
        )}
      </td>
      <td className="px-3 py-2 align-top">
        <div className="flex items-center justify-end gap-1.5">
          {canDownload && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onDownload?.(job)}
              disabled={!job.local_file_available}
              title={
                job.local_file_available
                  ? 'Download backup archive'
                  : 'Download unavailable — file no longer on local disk'
              }
            >
              <Download size={14} />
            </Button>
          )}
          {canRestore && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onRestore?.(job)}
              disabled={!job.local_file_available || job.status === 'running'}
              title="Restore from this backup"
            >
              <RefreshCw size={14} />
            </Button>
          )}
        </div>
      </td>
    </tr>
  );
}
