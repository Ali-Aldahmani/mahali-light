'use client';

import { useEffect } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { addBreadcrumb } from '@/services/breadcrumbService';

// Next's own route-segment error boundary. This sits at the root of app/,
// so — unlike the manually-placed <ErrorBoundary> that only wraps the
// (dashboard) layout's children — it also catches render errors on
// (auth)/login and (auth)/setup, which previously had no error handling
// at all (a failed fetch there could show a blank screen).
export default function RootError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    addBreadcrumb('react_error', { message: error?.message, digest: error?.digest });
    console.error('[app/error.tsx]', error);
  }, [error]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background p-8 text-center">
      <AlertTriangle size={40} className="text-warning" />
      <h1 className="mt-4 text-lg font-semibold text-ink">Something went wrong</h1>
      <p className="mt-1 max-w-md text-sm text-ink-muted">
        The error has been logged automatically. Try reloading this page.
      </p>
      <button
        type="button"
        onClick={reset}
        className="mt-6 flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90"
      >
        <RefreshCw size={14} /> Try again
      </button>
    </div>
  );
}
