import { useEffect, useMemo } from 'react';
import { CheckCheck, Settings, Inbox } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useNotificationStore } from '../../store/notificationStore.js';
import SlideOver from '../ui/SlideOver.jsx';
import NotificationItem from './NotificationItem.jsx';
import { cn } from '../../utils/cn.js';

const TABS = [
  { value: 'all', label: 'All', filter: { category: null, unread_only: false } },
  { value: 'unread', label: 'Unread', filter: { category: null, unread_only: true } },
  { value: 'approval', label: 'Approvals', filter: { category: 'approval', unread_only: false } },
  { value: 'stock', label: 'Stock', filter: { category: 'stock', unread_only: false } },
  { value: 'bill', label: 'Bills', filter: { category: 'bill', unread_only: false } },
  { value: 'attendance', label: 'Attendance', filter: { category: 'attendance', unread_only: false } },
  { value: 'system', label: 'System', filter: { category: 'system', unread_only: false } },
];

export default function NotificationPanel() {
  const navigate = useNavigate();
  const panelOpen = useNotificationStore((s) => s.panelOpen);
  const setPanelOpen = useNotificationStore((s) => s.setPanelOpen);
  const notifications = useNotificationStore((s) => s.notifications);
  const loading = useNotificationStore((s) => s.loading);
  const hasMore = useNotificationStore((s) => s.hasMore);
  const filter = useNotificationStore((s) => s.filter);
  const fetchNotifications = useNotificationStore((s) => s.fetchNotifications);
  const setFilter = useNotificationStore((s) => s.setFilter);
  const markAllRead = useNotificationStore((s) => s.markAllRead);
  const unreadCount = useNotificationStore((s) => s.unreadCount);

  useEffect(() => {
    if (panelOpen) fetchNotifications({ append: false });
  }, [panelOpen, fetchNotifications]);

  const activeTab = useMemo(() => {
    if (filter.unread_only) return 'unread';
    if (filter.category) return filter.category;
    return 'all';
  }, [filter]);

  function handleTab(t) {
    setFilter(t.filter);
  }

  return (
    <SlideOver
      open={panelOpen}
      onClose={() => setPanelOpen(false)}
      width="md"
      title={
        <span className="inline-flex items-center gap-2">
          Notifications
          {unreadCount > 0 && (
            <span className="inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-error px-1.5 text-[11px] font-semibold text-white">
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          )}
        </span>
      }
      subtitle="Real-time activity across your store"
    >
      <div className="-mx-6 -mt-5 border-b border-border bg-surface px-4 pb-3 pt-2 sticky top-0 z-10">
        <div className="flex items-center justify-between gap-2 px-2 py-1">
          <div className="flex flex-wrap items-center gap-1.5 overflow-x-auto">
            {TABS.map((t) => (
              <button
                key={t.value}
                type="button"
                onClick={() => handleTab(t)}
                className={cn(
                  'rounded-full px-3 py-1 text-xs font-medium transition',
                  activeTab === t.value
                    ? 'bg-accent text-white'
                    : 'bg-surface-2 text-ink-muted hover:text-ink',
                )}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center justify-end gap-1 px-2 pt-1.5">
          <button
            type="button"
            onClick={markAllRead}
            disabled={unreadCount === 0}
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-ink-muted hover:bg-surface-2 hover:text-ink disabled:opacity-50"
          >
            <CheckCheck size={13} />
            Mark all read
          </button>
          <button
            type="button"
            onClick={() => {
              setPanelOpen(false);
              navigate('/settings/notifications');
            }}
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-ink-muted hover:bg-surface-2 hover:text-ink"
          >
            <Settings size={13} />
            Settings
          </button>
        </div>
      </div>

      <div className="-mx-6 mt-2 divide-y divide-border">
        {loading && notifications.length === 0 ? (
          <div className="px-6 py-10 text-center text-sm text-ink-muted">
            Loading notifications…
          </div>
        ) : notifications.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-6 py-12 text-center text-ink-muted">
            <Inbox size={32} className="opacity-50" />
            <p className="text-sm font-medium text-ink">You're all caught up! 🎉</p>
            <p className="text-xs">No new notifications.</p>
          </div>
        ) : (
          notifications.map((n) => <NotificationItem key={n.id} notification={n} />)
        )}
      </div>

      {hasMore && notifications.length > 0 && (
        <div className="-mx-6 border-t border-border px-6 py-3 text-center">
          <button
            type="button"
            disabled={loading}
            onClick={() => fetchNotifications({ append: true })}
            className="rounded-md px-3 py-1 text-sm font-medium text-accent hover:bg-accent-light disabled:opacity-50"
          >
            {loading ? 'Loading…' : 'Load more'}
          </button>
        </div>
      )}
    </SlideOver>
  );
}
