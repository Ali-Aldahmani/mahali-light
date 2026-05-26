import { cn } from '../../utils/cn.js';

// items: [{ value, label, count?, icon? }]
export default function Tabs({
  items,
  value,
  onChange,
  className = '',
}) {
  return (
    <div className={cn('border-b border-border', className)}>
      <div className="flex items-center gap-1">
        {items.map((tab) => {
          const active = tab.value === value;
          return (
            <button
              key={tab.value}
              type="button"
              onClick={() => onChange?.(tab.value)}
              className={cn(
                'inline-flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium transition',
                'border-b-2 -mb-px',
                active
                  ? 'border-accent text-accent'
                  : 'border-transparent text-ink-muted hover:text-ink',
              )}
            >
              {tab.icon}
              <span>{tab.label}</span>
              {tab.count !== undefined && tab.count !== null && (
                <span
                  className={cn(
                    'ml-1 inline-flex items-center justify-center min-w-5 h-5 px-1.5 text-[11px] rounded-full',
                    active ? 'bg-accent-light text-accent' : 'bg-surface-2 text-ink-muted',
                  )}
                >
                  {tab.count}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
