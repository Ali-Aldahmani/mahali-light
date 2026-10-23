'use client';

import { useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import NotificationCenter, { type NotificationItem } from '@/components/ui/notification-center/NotificationCenter';
import { useNotificationStore } from '@/store/notificationStore';
import { useAuthStore } from '@/store/authStore';
import { timeAgo } from '@/lib/utils/format';

const TONES: Record<string, NotificationItem['tone']> = {
  critical: 'danger',
  error: 'danger',
  warning: 'warning',
  success: 'success',
};

/**
 * The header bell: the notification store (live via sockets) shown in the
 * NotificationCenter popover. Read / unread / dismiss go through the store,
 * which updates optimistically and syncs with the server.
 */
export default function HeaderNotifications() {
  const router = useRouter();
  const role = useAuthStore((s: any) => s.user?.role);
  const notifications = useNotificationStore((s) => s.notifications);
  const panelOpen = useNotificationStore((s) => s.panelOpen);
  const setPanelOpen = useNotificationStore((s) => s.setPanelOpen);
  const loading = useNotificationStore((s) => s.loading);
  const hasMore = useNotificationStore((s) => s.hasMore);
  const fetchNotifications = useNotificationStore((s) => s.fetchNotifications);
  const markRead = useNotificationStore((s) => s.markRead);
  const markUnread = useNotificationStore((s) => s.markUnread);
  const dismiss = useNotificationStore((s) => s.dismiss);
  const setPinned = useNotificationStore((s) => s.setPinned);

  // Refresh the list each time the panel opens.
  useEffect(() => {
    if (panelOpen) fetchNotifications({ append: false });
  }, [panelOpen, fetchNotifications]);

  const items = useMemo<NotificationItem[]>(
    () =>
      notifications.map((n) => ({
        id: String(n.id),
        title: n.title || 'Notification',
        description: n.message || undefined,
        time: n.created_at ? timeAgo(n.created_at) : '',
        read: !!n.is_read,
        tone: TONES[n.severity as string] || 'info',
        action: n.action_url
          ? { label: 'Open', onSelect: () => router.push(n.action_url) }
          : undefined,
        // Only an Admin may dismiss critical notifications (the server enforces it too).
        dismissible: !(n.severity === 'critical' && role !== 'Admin'),
        pinned: !!n.pinned_at,
        pinnedAt: n.pinned_at || null,
      })),
    [notifications, role, router],
  );

  const byId = (id: string) => notifications.find((n) => String(n.id) === id)?.id ?? id;

  return (
    <NotificationCenter
      notifications={items}
      open={panelOpen}
      onOpenChange={setPanelOpen}
      onReadChange={(item, read) => (read ? markRead(byId(item.id)) : markUnread(byId(item.id)))}
      onDismiss={(item) => dismiss(byId(item.id))}
      onPinChange={(item, pinned) => setPinned(byId(item.id), pinned)}
      onSettings={() => router.push('/settings/notifications')}
      hasMore={hasMore}
      loading={loading}
      onLoadMore={() => fetchNotifications({ append: true })}
    />
  );
}
