import { useRef, useState, useEffect } from 'react';
import { Upload, X, FileText, Image as ImageIcon } from 'lucide-react';
import { toast } from '../../store/toastStore.js';

const ALLOWED_MIME = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
]);
const MAX_BYTES = 5 * 1024 * 1024;

// Uncontrolled receipt upload — emits the File via onSelect / onClear so
// callers can drop it into FormData when they submit the parent form.
export default function ReceiptUpload({
  onSelect,
  onClear,
  hint = 'PDF, JPG or PNG · max 5 MB',
  buttonLabel = 'Upload receipt',
}) {
  const inputRef = useRef(null);
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);

  useEffect(() => {
    if (!file) {
      setPreview(null);
      return;
    }
    if (file.type.startsWith('image/')) {
      const url = URL.createObjectURL(file);
      setPreview(url);
      return () => URL.revokeObjectURL(url);
    }
    setPreview(null);
    return undefined;
  }, [file]);

  function pick(files) {
    const f = files?.[0];
    if (!f) return;
    if (!ALLOWED_MIME.has(f.type)) {
      toast.error('Only PDF, JPG or PNG receipts are allowed.');
      return;
    }
    if (f.size > MAX_BYTES) {
      toast.error('Receipt is too large (max 5 MB).');
      return;
    }
    setFile(f);
    onSelect?.(f);
  }

  function clear() {
    setFile(null);
    if (inputRef.current) inputRef.current.value = '';
    onClear?.();
  }

  return (
    <div className="space-y-2">
      <input
        ref={inputRef}
        type="file"
        accept="application/pdf,image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={(e) => pick(e.target.files)}
      />
      {!file ? (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="flex w-full items-center justify-center gap-2 rounded-input border border-dashed border-border bg-surface-2 py-3 text-sm text-ink-muted hover:bg-surface hover:text-ink"
        >
          <Upload size={16} />
          {buttonLabel}
        </button>
      ) : (
        <div className="flex items-center gap-3 rounded-input border border-border bg-surface p-2.5">
          <div className="h-12 w-12 shrink-0 rounded-md bg-surface-2 flex items-center justify-center overflow-hidden">
            {preview ? (
              <img src={preview} alt="" className="h-full w-full object-cover" />
            ) : file.type === 'application/pdf' ? (
              <FileText size={20} className="text-ink-muted" />
            ) : (
              <ImageIcon size={20} className="text-ink-muted" />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium" title={file.name}>
              {file.name}
            </div>
            <div className="text-xs text-ink-muted">
              {(file.size / 1024).toFixed(1)} KB
            </div>
          </div>
          <button
            type="button"
            onClick={clear}
            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-error hover:bg-error-light"
            title="Remove"
          >
            <X size={16} />
          </button>
        </div>
      )}
      <div className="text-xs text-ink-muted">{hint}</div>
    </div>
  );
}
