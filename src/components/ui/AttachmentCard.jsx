import { FileText, ImageIcon, Download, Trash2 } from 'lucide-react';
import { fileUrl } from '../../config.js';

function inferType(path) {
  if (!path) return 'unknown';
  const lower = path.toLowerCase();
  if (lower.endsWith('.pdf')) return 'pdf';
  if (
    lower.endsWith('.webp') ||
    lower.endsWith('.jpg') ||
    lower.endsWith('.jpeg') ||
    lower.endsWith('.png')
  )
    return 'image';
  return 'file';
}

function formatBytes(n) {
  if (!n) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

export default function AttachmentCard({
  path,
  filename,
  uploadedAt,
  uploadedBy,
  size,
  onDelete,
}) {
  const type = inferType(path);
  const url = path ? fileUrl(path) : null;
  const Icon = type === 'image' ? ImageIcon : FileText;

  return (
    <div className="flex items-center gap-3 rounded-card border border-border bg-surface p-3 shadow-soft">
      <div className="h-12 w-12 rounded-md bg-surface-2 flex items-center justify-center text-ink-muted shrink-0 overflow-hidden">
        {type === 'image' && url ? (
          <img src={url} alt="" className="h-full w-full object-cover" />
        ) : (
          <Icon size={20} />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-ink truncate" title={filename}>
          {filename || (path ? path.split('/').pop() : 'Attachment')}
        </div>
        <div className="text-xs text-ink-muted">
          {uploadedAt ? new Date(uploadedAt).toLocaleString() : ''}
          {uploadedBy ? ` · ${uploadedBy}` : ''}
          {size ? ` · ${formatBytes(size)}` : ''}
        </div>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        {url && (
          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            download
            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-ink-muted hover:bg-surface-2"
            title="Download"
          >
            <Download size={16} />
          </a>
        )}
        {onDelete && (
          <button
            type="button"
            onClick={onDelete}
            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-error hover:bg-error-light"
            title="Delete"
          >
            <Trash2 size={16} />
          </button>
        )}
      </div>
    </div>
  );
}
