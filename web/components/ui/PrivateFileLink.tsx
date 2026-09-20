'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { getFilesBase } from '@/lib/config';
import { useAuthStore } from '@/store/authStore';

// Blob URLs keep bearer tokens out of URLs, browser history and referrers.
export function usePrivateFileUrl(path?: string | null) {
  const token = useAuthStore((state) => state.token);
  const [file, setFile] = useState<{ path: string; token: string; url: string } | null>(null);
  useEffect(() => {
    if (!path || !token || !/^(purchase-orders|supplier-payments|receipts\/(bills|expenses)|bug-reports)\//.test(path)) return;
    const controller = new AbortController();
    let objectUrl: string | undefined;
    fetch(`${getFilesBase()}/${path.split('/').map(encodeURIComponent).join('/')}`, {
      headers: { Authorization: `Bearer ${token}` }, signal: controller.signal, cache: 'no-store',
    }).then(async (response) => {
      if (!response.ok) throw new Error('Attachment unavailable');
      const blob = await response.blob();
      if (controller.signal.aborted) return;
      objectUrl = URL.createObjectURL(blob);
      setFile({ path, token, url: objectUrl });
    }).catch(() => { if (!controller.signal.aborted) setFile(null); });
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [path, token]);
  return file?.path === path && file?.token === token ? file.url : undefined;
}

export default function PrivateFileLink({ path, children, className, title }: {
  path?: string | null; children: ReactNode; className?: string; title?: string;
}) {
  const url = usePrivateFileUrl(path);
  return <a href={url} target="_blank" rel="noreferrer" download={path?.split('/').pop()}
    className={className} title={title || (url ? 'Download attachment' : 'Attachment unavailable or loading')}
    aria-disabled={!url}>{children}</a>;
}
