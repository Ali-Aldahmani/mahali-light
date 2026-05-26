import { Bell } from 'lucide-react';
import { useNotificationStore } from '../../store/notificationStore.js';
import { cn } from '../../utils/cn.js';

export default function NotificationBell({ className = '' }) {
  const unread = useNotificationStore((s) => s.unreadCount);
  const togglePanel = useNotificationStore((s) => s.togglePanel);
  const hasCritical = useNotificationStore((s) =>
    s.notifications.some((n) => n.severity === 'critical' && !n.is_read),
  );

  return (
    <button
      type="button"
      onClick={togglePanel}
      className={cn(
        'relative inline-flex h-9 w-9 items-center justify-center rounded-full text-ink-muted hover:bg-surface-2 hover:text-ink',
        hasCritical ? 'text-error' : '',
        className,
      )}
      title="Notifications"
      aria-label={`Notifications${unread ? ` (${unread} unread)` : ''}`}
    >
      <Bell
        size={18}
        className={hasCritical ? 'animate-pulse' : ''}
      />
      {unread > 0 && (
        <span
          className={cn(
            'absolute -top-0.5 -right-0.5 inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-error px-1 text-[10px] font-semibold text-white',
            unread > 99 ? 'px-1.5' : '',
          )}
        >
          {unread > 99 ? '99+' : unread}
        </span>
      )}
    </button>
  );
}
