import { useEffect, useState } from 'react';
import { Users } from 'lucide-react';
import { usePresenceStore } from '../../store/presenceStore.js';
import { useAuthStore } from '../../store/authStore.js';
import { listOnline } from '../../services/presenceService.js';
import Avatar from '../ui/Avatar.jsx';
import { timeAgo } from '../../utils/format.js';
import { cn } from '../../utils/cn.js';

export default function PresenceWidget() {
  const onlineUsers = usePresenceStore((s) => s.onlineUsers);
  const setOnlineUsers = usePresenceStore((s) => s.setOnlineUsers);
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const [open, setOpen] = useState(false);

  const canSeeAll = hasPermission('user.edit') || hasPermission('user.force_logout');

  useEffect(() => {
    if (!canSeeAll) return;
    let cancelled = false;
    listOnline()
      .then((rows) => {
        if (cancelled) return;
        const mapped = (rows || []).map((r) => ({
          userId: r.userId,
          username: r.username,
          role: r.role,
          pcIdentifier: r.pcIdentifier,
          status: r.status,
          lastActivityAt: r.lastActivityAt,
        }));
        setOnlineUsers(mapped);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [canSeeAll, setOnlineUsers]);

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
                  key={`${u.userId}-${u.pcIdentifier}`}
                  name={u.username}
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
            </div>
            <div className="max-h-80 overflow-y-auto">
              {onlineUsers.length === 0 ? (
                <p className="px-4 py-6 text-sm text-ink-muted text-center">
                  Nobody is signed in right now.
                </p>
              ) : (
                onlineUsers.map((u) => (
                  <div
                    key={`${u.userId}-${u.pcIdentifier}`}
                    className="flex items-center gap-3 px-4 py-2.5 hover:bg-surface-2"
                  >
                    <Avatar name={u.username} size="sm" online status={u.status} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-ink truncate">
                        {u.username}
                      </p>
                      <p className="text-xs text-ink-muted truncate">
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
                          {timeAgo(u.lastActivityAt)}
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
