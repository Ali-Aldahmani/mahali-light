import { Folder } from 'lucide-react';
import { cn } from '../../utils/cn.js';

// Renders the emoji + name for a category. When the category is missing or
// has no emoji we fall back to a generic folder icon. Used in tables and
// dropdowns alike — call site can pick whichever variant they need.
export default function ExpenseCategoryIcon({
  icon,
  name,
  hideName = false,
  size = 'md',
  className = '',
}) {
  const sizePx = size === 'lg' ? 'text-xl' : size === 'sm' ? 'text-sm' : 'text-base';
  return (
    <span className={cn('inline-flex items-center gap-1.5', className)}>
      {icon ? (
        <span className={cn('leading-none', sizePx)} aria-hidden>
          {icon}
        </span>
      ) : (
        <Folder className="h-4 w-4 text-ink-muted" />
      )}
      {!hideName && <span className="text-sm">{name || '—'}</span>}
    </span>
  );
}
