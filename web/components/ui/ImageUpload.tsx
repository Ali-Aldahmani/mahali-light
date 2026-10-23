import { useEffect, useMemo, useRef, useState } from 'react';
import { cn } from '@/lib/utils/cn';
import { fileUrl } from '@/lib/config';
import type { UploadOptions } from '@/services/http';
import { FileDropzone, uploadWith, type FileDropzoneItem } from './file-dropzone';

const ACCEPT = 'image/jpeg,image/png,image/webp';
const MAX_BYTES = 5 * 1024 * 1024;

// Image upload built on FileDropzone. Keeps its original modes:
//   - controlled upload: pass `onUpload(file, opts) → Promise` and the row shows
//     progress, then reflects the stored image through `value`.
//   - deferred mode: pass `onChange(file)` to bubble the File to the parent
//     (used by the wizard before the product exists).
interface ImageUploadProps {
  value?: string | null; // stored relative path on the server
  onUpload?: (file: File, opts?: UploadOptions) => Promise<any>;
  onRemove?: () => Promise<void>;
  onChange?: (file: File | null) => void;
  label?: string | null;
  hint?: string;
  className?: string;
  disabled?: boolean;
}

function storedItem(path: string): FileDropzoneItem {
  return {
    id: `stored:${path}`,
    name: path.split('/').pop() || 'Image',
    size: 0,
    status: 'uploaded',
    progress: 100,
    preview: fileUrl(path),
  };
}

export default function ImageUpload({
  value = null,
  onUpload,
  onRemove,
  onChange,
  label = 'Product image',
  hint = 'JPG, PNG or WebP up to 5 MB. Compressed to 800x800.',
  className = '',
  disabled = false,
}: ImageUploadProps) {
  // The dropzone owns its rows after mount. When `value` changes because of
  // something outside it (another record loaded), it is remounted with the new
  // stored image; changes it caused itself (an upload, a removal) are expected.
  const [generation, setGeneration] = useState(0);
  const lastValue = useRef(value);
  const expectChange = useRef(false);
  useEffect(() => {
    if (lastValue.current === value) return;
    lastValue.current = value;
    if (expectChange.current) expectChange.current = false;
    else setGeneration((g) => g + 1);
  }, [value]);

  const defaultItems = useMemo(
    () => (value ? [storedItem(value)] : []),
    // Only read at mount of each generation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [generation],
  );

  const upload = onUpload
    ? uploadWith((file, opts) => {
        expectChange.current = true;
        return onUpload(file, opts).catch((err) => {
          expectChange.current = false;
          throw err;
        });
      })
    : undefined;

  function handleRemove(item: FileDropzoneItem) {
    if (onUpload) {
      // Only an image that reached the server needs deleting.
      if (item.status === 'uploaded' && onRemove) {
        expectChange.current = true;
        onRemove().catch(() => {
          expectChange.current = false;
        });
      }
    }
  }

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      {label && <span className="text-sm font-medium text-ink">{label}</span>}
      <FileDropzone
        key={generation}
        accept={ACCEPT}
        multiple={false}
        maxFiles={1}
        maxSize={MAX_BYTES}
        label={value ? 'Replace image' : 'Add an image'}
        description="Drop an image here, paste it, or choose one"
        note={hint}
        dropLabel="Drop to use this image"
        defaultItems={defaultItems}
        onUpload={upload}
        onRemove={handleRemove}
        onFilesChange={
          onUpload
            ? undefined
            : (files) => {
                const file = files[0];
                onChange?.(file && file.size <= MAX_BYTES ? file : null);
              }
        }
        disabled={disabled}
      />
    </div>
  );
}
