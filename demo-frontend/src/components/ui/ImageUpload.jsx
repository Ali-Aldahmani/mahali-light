import { useRef, useState } from 'react';
import { ImagePlus, Trash2, UploadCloud } from 'lucide-react';
import { cn } from '../../utils/cn.js';
import { fileUrl } from '../../config.js';
import Spinner from './Spinner.jsx';

const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_BYTES = 5 * 1024 * 1024;

// Drag-and-drop image upload with thumbnail preview.
// Either receives a stored relative path (`value`) or a local File preview.
// Modes:
//   - controlled upload: pass `onUpload(file) → Promise<string>` and let the
//     component call the API and reflect the result via `value`.
//   - deferred mode: pass `onChange(file)` to bubble the File to the parent
//     (used by the wizard before the product exists).
export default function ImageUpload({
  value = null, // stored relative path on the server
  onUpload, // (file: File) => Promise<string|object>
  onRemove, // () => Promise<void>
  onChange, // (file: File|null) => void
  label = 'Product image',
  hint = 'JPG, PNG or WebP up to 5 MB. Compressed to 800x800.',
  className = '',
  disabled = false,
}) {
  const fileInput = useRef(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [dragOver, setDragOver] = useState(false);

  const remoteUrl = value ? fileUrl(value) : null;
  const displayUrl = previewUrl || remoteUrl;

  async function handleFiles(files) {
    setError(null);
    const file = files && files[0];
    if (!file) return;
    if (!ALLOWED_MIME.includes(file.type)) {
      setError('Only JPG, PNG or WebP images are allowed.');
      return;
    }
    if (file.size > MAX_BYTES) {
      setError('Image is too large. Maximum size is 5 MB.');
      return;
    }

    const localUrl = URL.createObjectURL(file);
    setPreviewUrl(localUrl);

    if (onUpload) {
      setBusy(true);
      try {
        await onUpload(file);
      } catch (err) {
        setError(err?.message || 'Upload failed.');
      } finally {
        setBusy(false);
        // The preview comes from the server URL once value updates.
        setTimeout(() => {
          URL.revokeObjectURL(localUrl);
          setPreviewUrl(null);
        }, 1500);
      }
    } else if (onChange) {
      onChange(file);
    }
  }

  async function handleRemove() {
    if (busy) return;
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    setError(null);
    if (onRemove) {
      setBusy(true);
      try {
        await onRemove();
      } catch (err) {
        setError(err?.message || 'Could not remove image.');
      } finally {
        setBusy(false);
      }
    } else if (onChange) {
      onChange(null);
    }
  }

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      {label && (
        <div className="flex items-center justify-between">
          <label className="text-sm font-medium text-ink">{label}</label>
          {displayUrl && !disabled && (
            <button
              type="button"
              onClick={handleRemove}
              className="text-xs text-error hover:underline inline-flex items-center gap-1"
            >
              <Trash2 size={12} /> Remove
            </button>
          )}
        </div>
      )}

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          if (!disabled) handleFiles(e.dataTransfer.files);
        }}
        onClick={() => !disabled && fileInput.current?.click()}
        className={cn(
          'relative flex flex-col items-center justify-center min-h-[180px] rounded-card border-2 border-dashed bg-surface-2 text-center cursor-pointer transition',
          dragOver
            ? 'border-accent bg-accent-light'
            : 'border-border hover:border-accent hover:bg-accent-light/40',
          disabled && 'opacity-60 cursor-not-allowed',
        )}
      >
        {displayUrl ? (
          <img
            src={displayUrl}
            alt="Preview"
            className="max-h-44 max-w-full rounded-lg object-contain p-3"
          />
        ) : (
          <>
            <div className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-accent-light text-accent mb-2">
              <UploadCloud size={20} />
            </div>
            <p className="text-sm text-ink font-medium">
              Drop an image here, or click to upload
            </p>
            <p className="text-xs text-ink-muted mt-1">{hint}</p>
          </>
        )}

        {busy && (
          <div className="absolute inset-0 bg-surface/70 rounded-card flex items-center justify-center">
            <Spinner size="md" className="text-accent" />
          </div>
        )}

        <input
          ref={fileInput}
          type="file"
          accept={ALLOWED_MIME.join(',')}
          className="hidden"
          onChange={(e) => handleFiles(e.target.files)}
        />
      </div>

      {displayUrl && !disabled && !value && !busy && (
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            fileInput.current?.click();
          }}
          className="text-xs text-accent hover:underline inline-flex items-center gap-1 self-start"
        >
          <ImagePlus size={12} /> Replace image
        </button>
      )}

      {error && <p className="text-xs text-error">{error}</p>}
    </div>
  );
}
