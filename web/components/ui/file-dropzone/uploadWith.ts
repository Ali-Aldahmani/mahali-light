import type { FileDropzoneUpload } from './FileDropzone';

type Options = { onProgress?: (percent: number) => void; signal?: AbortSignal };

/**
 * Wraps an app upload call (`(file, { onProgress, signal }) => Promise`) as a
 * FileDropzone `onUpload`. API failures arrive as plain `{ message }` objects,
 * so they are turned into Errors whose message becomes the row's reason.
 */
export function uploadWith<T>(
  send: (file: File, options: Options) => Promise<T>,
  onDone?: (result: T) => void,
): FileDropzoneUpload {
  return async (item, { onProgress, signal }) => {
    if (!item.file) throw new Error('No file to upload');
    let result: T;
    try {
      result = await send(item.file, { onProgress, signal });
    } catch (err: any) {
      throw new Error(err?.message || 'Upload failed');
    }
    if (!signal.aborted) onDone?.(result);
  };
}
