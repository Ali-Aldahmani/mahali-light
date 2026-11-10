import { useEffect, useMemo, useState } from 'react';
import { Users } from 'lucide-react';
import { usePresenceStore } from '@/store/presenceStore';
import { useAuthStore } from '@/store/authStore';
import { useSocketStore } from '@/store/socketStore';
import { useServerNow } from '@/lib/utils/serverClock';
import Avatar from '../ui/Avatar';
import { timeAgo } from '@/lib/utils/format';
import { cn } from '@/lib/utils/cn';

// Staff know each other by name; the username is shown underneath.
const displayName = (u: { employeeName?: string | null; username?: string; [key: string]: any }) => u.employeeName || u.username || 'Unknown';

export default function PresenceWidget() {
  const rawUsers = usePresenceStore((s) => s.onlineUsers);
  const isLive = useSocketStore((s) => s.isConnected);
  const now = useServerNow(30000);
  // Active people first, then idle; by name within each, so the list stays put.
  const onlineUsers = useMemo(() => [...rawUsers].sort((a, b) =>
    (a.status === 'idle' ? 1 : 0) - (b.status === 'idle' ? 1 : 0)
    || displayName(a).localeCompare(displayName(b))), [rawUsers]);
  const refresh = usePresenceStore((s) => s.refresh);
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const [open, setOpen] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);

  // Same rule as the server's presence feed (user.edit or user.force_logout).
  const canSeeAll = hasPermission('user.edit') || hasPermission('user.force_logout');

  // The socket store re-reads the list on every (re)connect; this covers the
  // widget appearing after the socket is already up.
  useEffect(() => {
    if (!canSeeAll) return;
    let cancelled = false;
    refresh()
      .then(() => { if (!cancelled) setLoadFailed(false); })
      .catch(() => { if (!cancelled) setLoadFailed(true); });
    return () => {
      cancelled = true;
    };
  }, [canSeeAll, refresh]);

  if (!canSeeAll) return null;


  const visible = onlineUsers.slice(0, 5);
  const overflow = Math.max(0, onlineUsers.length - visible.length);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 rounded-full border border-border bg-surface px-2 py-1 hover:bg-surface-2"
      >
        <Users size={14} className="text-ink-muted" />
        {visible.length === 0 ? (
          <span className="text-xs text-ink-muted px-1">No one online</span>
        ) : (
          <>
            <div className="flex -space-x-2">
              {visible.map((u) => (
                <Avatar
                  key={String(u.userId)}
                  name={displayName(u)}
                  size="xs"
                  online
                  status={u.status}
                />
              ))}
            </div>
            {overflow > 0 && (
              <span className="ml-1 text-xs font-medium text-ink-muted">+{overflow}</span>
            )}
          </>
        )}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full z-40 mt-2 w-80 card overflow-hidden">
            <div className="px-4 py-3 border-b border-border">
              <h3 className="text-sm font-semibold text-ink">
                Online users ({onlineUsers.length})
              </h3>
              {!isLive && (
                <p className="mt-1 text-xs text-warning">
                  Not live: this screen lost its connection, so the list may be out of date. It refreshes when the connection is back.
                </p>
              )}
            </div>
            <div className="max-h-80 overflow-y-auto">
              {loadFailed ? (
                <p className="px-4 py-6 text-sm text-error text-center">
                  Couldn&apos;t load who is online. It updates again when the connection is back.
                </p>
              ) : onlineUsers.length === 0 ? (
                <p className="px-4 py-6 text-sm text-ink-muted text-center">
                  Nobody is signed in right now.
                </p>
              ) : (
                onlineUsers.map((u) => (
                  <div
                    key={String(u.userId)}
                    className="flex items-center gap-3 px-4 py-2.5 hover:bg-surface-2"
                  >
                    <Avatar name={displayName(u)} size="sm" online status={u.status} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-ink truncate">
                        {displayName(u)}
                        {/* Next to the name: the PC line below is cut off when long. */}
                        {(u.sessionCount || 1) > 1 && (
                          <span className="ml-1.5 text-[11px] font-normal text-ink-muted">
                            · {u.sessionCount} devices
                          </span>
                        )}
                      </p>
                      <p className="text-xs text-ink-muted truncate">
                        {u.employeeName ? `${u.username} · ` : ''}
                        {u.role || '—'} · {u.pcIdentifier}
                      </p>
                    </div>
                    <span
                      className={cn(
                        'text-[11px]',
                        u.status === 'idle' ? 'text-warning' : 'text-success',
                      )}
                    >
                      {u.status === 'idle' ? 'Idle' : 'Online'}
                      {u.lastActivityAt && (
                        <span className="block text-ink-muted">
                          {timeAgo(u.lastActivityAt, now)}
                        </span>
                      )}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
