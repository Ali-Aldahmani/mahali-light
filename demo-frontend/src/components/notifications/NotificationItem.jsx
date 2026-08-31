import { useNavigate } from 'react-router-dom';
import { X } from 'lucide-react';
import { useNotificationStore } from '../../store/notificationStore.js';
import { timeAgo } from '../../utils/format.js';
import { cn } from '../../utils/cn.js';
import SeverityIcon from './SeverityIcon.jsx';
import CategoryIcon from './CategoryIcon.jsx';

const SEVERITY_BORDER = {
  info: 'border-l-blue-400',
  warning: 'border-l-warning',
  error: 'border-l-error',
  critical: 'border-l-error',
};

export default function NotificationItem({ notification, onAction }) {
  const navigate = useNavigate();
  const markRead = useNotificationStore((s) => s.markRead);
  const dismiss = useNotificationStore((s) => s.dismiss);
  const setPanelOpen = useNotificationStore((s) => s.setPanelOpen);

  function handleClick() {
    if (!notification.is_read) markRead(notification.id);
    if (notification.action_url) {
      setPanelOpen(false);
      navigate(notification.action_url);
      if (onAction) onAction(notification);
    }
  }

  function handleDismiss(e) {
    e.stopPropagation();
    dismiss(notification.id);
  }

  const borderTone = SEVERITY_BORDER[notification.severity] || SEVERITY_BORDER.info;

  return (
    <button
      type="button"
      onClick={handleClick}
      className={cn(
        'group block w-full border-l-4 px-4 py-3 text-left transition',
        borderTone,
        notification.is_read
          ? 'bg-surface-2 hover:bg-surface-2'
          : 'bg-white hover:bg-accent-light/40',
      )}
    >
      <div className="flex items-start gap-3">
        <CategoryIcon category={notification.category} size={14} withBg />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <SeverityIcon
              severity={notification.severity}
              size={12}
              pulse
            />
            <span className={cn(
              'truncate text-sm',
              notification.is_read ? 'font-medium text-ink' : 'font-semibold text-ink',
            )}>
              {notification.title}
            </span>
            <span className="ml-auto shrink-0 text-[11px] text-ink-muted">
              {timeAgo(notification.created_at)}
            </span>
          </div>
          <p className="mt-1 line-clamp-3 text-xs text-ink-muted">
            {notification.message}
          </p>
          {notification.action_url && (
            <p className="mt-1 text-[11px] font-medium text-accent">
              View details →
            </p>
          )}
        </div>
        <span
          role="button"
          tabIndex={0}
          onClick={handleDismiss}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') handleDismiss(e);
          }}
          className="invisible mt-0.5 rounded-md p-1 text-ink-muted hover:bg-surface-2 hover:text-ink group-hover:visible"
          title={notification.severity === 'critical' ? 'Critical — admin only' : 'Dismiss'}
        >
          <X size={14} />
        </span>
      </div>
    </button>
  );
}
