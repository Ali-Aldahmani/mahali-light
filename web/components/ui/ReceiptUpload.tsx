import { FileDropzone } from './file-dropzone';

const ACCEPT = 'application/pdf,image/jpeg,image/png,image/webp';
const MAX_BYTES = 5 * 1024 * 1024;

// Uncontrolled receipt picker built on FileDropzone — emits the File via
// onSelect / onClear so callers can drop it into FormData when they submit
// the parent form. Nothing uploads until then.
export default function ReceiptUpload({
  onSelect,
  onClear,
  hint = 'PDF, JPG or PNG · max 5 MB',
  buttonLabel = 'Upload receipt',
}: {
  onSelect?: (file: File) => void;
  onClear?: () => void;
  hint?: string;
  buttonLabel?: string;
}) {
  return (
    <FileDropzone
      accept={ACCEPT}
      multiple={false}
      maxFiles={1}
      maxSize={MAX_BYTES}
      label={buttonLabel}
      description="Drop a file here, paste it, or choose one"
      note={hint}
      dropLabel="Drop to attach"
      onFilesChange={(files) => {
        const file = files[0];
        if (file && file.size <= MAX_BYTES) onSelect?.(file);
        else onClear?.();
      }}
    />
  );
}
