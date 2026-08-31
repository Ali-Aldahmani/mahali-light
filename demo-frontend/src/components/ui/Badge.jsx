import { cn } from '../../utils/cn.js';

const TONE_CLASSES = {
  neutral: 'bg-surface-2 text-ink',
  muted: 'bg-surface-2 text-ink-muted',
  accent: 'bg-accent-light text-accent',
  success: 'bg-success-light text-success',
  warning: 'bg-warning-light text-warning',
  error: 'bg-error-light text-error',
};

const SIZE_CLASSES = {
  sm: 'h-5 px-2 text-[11px]',
  md: 'h-6 px-2.5 text-xs',
  lg: 'h-7 px-3 text-sm',
};

// Maps role names to a consistent visual tone.
const ROLE_TONES = {
  Admin: 'accent',
  Manager: 'success',
  Cashier: 'warning',
  Warehouse: 'neutral',
};

export default function Badge({
  tone = 'neutral',
  size = 'md',
  className = '',
  dot = false,
  children,
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full font-medium whitespace-nowrap',
        TONE_CLASSES[tone] || TONE_CLASSES.neutral,
        SIZE_CLASSES[size],
        className,
      )}
    >
      {dot && (
        <span
          className={cn(
            'inline-block h-1.5 w-1.5 rounded-full',
            tone === 'success'
              ? 'bg-success'
              : tone === 'error'
                ? 'bg-error'
                : tone === 'warning'
                  ? 'bg-warning'
                  : tone === 'accent'
                    ? 'bg-accent'
                    : 'bg-ink-muted',
          )}
        />
      )}
      {children}
    </span>
  );
}

export function RoleBadge({ role, size = 'md' }) {
  if (!role) return <Badge tone="muted" size={size}>—</Badge>;
  return (
    <Badge tone={ROLE_TONES[role] || 'neutral'} size={size}>
      {role}
    </Badge>
  );
}

export function StatusBadge({ active, size = 'md' }) {
  return (
    <Badge tone={active ? 'success' : 'error'} size={size} dot>
      {active ? 'Active' : 'Inactive'}
    </Badge>
  );
}

export function OnlineBadge({ online, status, size = 'sm' }) {
  if (online) {
    const tone = status === 'idle' ? 'warning' : 'success';
    return (
      <Badge tone={tone} size={size} dot>
        {status === 'idle' ? 'Idle' : 'Online'}
      </Badge>
    );
  }
  return (
    <Badge tone="muted" size={size}>
      Offline
    </Badge>
  );
}
