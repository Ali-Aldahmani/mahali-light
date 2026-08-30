import { WifiOff, RefreshCw } from 'lucide-react';
import { useOfflineStore } from '../../store/offlineStore.js';
import { getApiOrigin } from '../../config.js';
import { toast } from '../../store/toastStore.js';
import { formatDateTime } from '../../utils/format.js';

export default function OfflineBanner() {
  const isOffline = useOfflineStore((s) => s.isOffline);
  const offlineSince = useOfflineStore((s) => s.offlineSince);
  const queuedCount = useOfflineStore((s) => s.queuedCount);
  const setOffline = useOfflineStore((s) => s.setOffline);

  if (!isOffline) return null;

  const retry = async () => {
    try {
      const res = await fetch(`${getApiOrigin()}/api/health`, { cache: 'no-store' });
      if (res.ok) {
        setOffline(false);
        toast.success('Reconnected');
      }
    } catch (_e) {
      toast.warning('Still offline — will retry automatically.');
    }
  };

  return (
    <div className="flex items-center justify-between gap-3 border-b border-warning/30 bg-warning-light px-4 py-2 text-sm text-ink">
      <div className="flex items-center gap-2">
        <WifiOff size={16} className="text-warning" />
        <span>
          <strong>Offline</strong> — POS mode active
          {queuedCount > 0 && ` · Queued: ${queuedCount} action${queuedCount === 1 ? '' : 's'}`}
          {offlineSince && (
            <span className="text-ink-muted">
              {' '}
              · Since {formatDateTime(offlineSince)}
            </span>
          )}
        </span>
      </div>
      <button
        type="button"
        onClick={retry}
        className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold text-accent hover:bg-accent-light"
      >
        <RefreshCw size={14} /> Retry
      </button>
    </div>
  );
}
