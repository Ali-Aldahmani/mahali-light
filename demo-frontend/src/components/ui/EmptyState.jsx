import { isValidElement, createElement } from 'react';
import { cn } from '../../utils/cn.js';

export default function EmptyState({
  icon = null,
  title,
  description,
  action = null,
  className = '',
}) {
  // `icon` may be either a pre-rendered JSX element (<ShieldCheck size={24} />)
  // or a component reference (ShieldCheck).  Lucide icons are forwardRef objects
  // so typeof === 'object', not 'function' — handle both cases.
  const iconEl = icon
    ? isValidElement(icon)
      ? icon
      : createElement(icon, { size: 24 })
    : null;

  return (
    <div
      className={cn(
        'card flex flex-col items-center justify-center text-center px-6 py-14',
        className,
      )}
    >
      {iconEl && (
        <div className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-full bg-accent-light text-accent">
          {iconEl}
        </div>
      )}
      <h3 className="text-base font-semibold text-ink">{title}</h3>
      {description && (
        <p className="mt-1 text-sm text-ink-muted max-w-md">{description}</p>
      )}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
