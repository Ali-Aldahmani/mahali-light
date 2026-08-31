import { useNotificationStore } from '../../store/notificationStore.js';
import { cn } from '../../utils/cn.js';

export default function ApprovalCountBadge({ className = '' }) {
  const count = useNotificationStore((s) => s.approvalCount);
  if (!count || count <= 0) return null;
  return (
    <span
      className={cn(
        'inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-accent px-1.5 text-[11px] font-semibold text-white',
        className,
      )}
    >
      {count > 99 ? '99+' : count}
    </span>
  );
}
