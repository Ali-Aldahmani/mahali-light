import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, Search } from 'lucide-react';
import { cn } from '../../utils/cn.js';

// Searchable single-select dropdown.
// options: [{ value, label, description? }]
export default function Select({
  label,
  value,
  onChange,
  options = [],
  placeholder = 'Select…',
  searchable = true,
  error,
  hint,
  disabled = false,
  required = false,
  className = '',
  containerClassName = '',
  emptyLabel = 'No matches',
}) {
  const autoId = useId();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const ref = useRef(null);

  const selected = useMemo(
    () => options.find((o) => o.value === value) || null,
    [options, value],
  );

  const filtered = useMemo(() => {
    if (!q) return options;
    const term = q.toLowerCase();
    return options.filter(
      (o) =>
        o.label.toLowerCase().includes(term) ||
        (o.description && o.description.toLowerCase().includes(term)),
    );
  }, [options, q]);

  useEffect(() => {
    function handle(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, []);

  return (
    <div className={cn('flex flex-col gap-1.5 relative', containerClassName)} ref={ref}>
      {label && (
        <label htmlFor={autoId} className="text-sm font-medium text-ink">
          {label}
          {required && <span className="text-error ml-0.5">*</span>}
        </label>
      )}
      <button
        id={autoId}
        type="button"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'flex h-10 items-center justify-between rounded-input border bg-surface px-3 text-sm transition',
          error
            ? 'border-error'
            : 'border-border hover:border-ink-muted focus:border-accent focus:ring-2 focus:ring-accent/20',
          disabled && 'opacity-60 cursor-not-allowed',
          className,
        )}
      >
        <span className={cn('truncate', !selected && 'text-ink-muted')}>
          {selected ? selected.label : placeholder}
        </span>
        <ChevronDown size={16} className="text-ink-muted shrink-0 ml-2" />
      </button>

      {open && (
        <div className="absolute z-30 top-full mt-1 w-full rounded-card border border-border bg-surface shadow-pop overflow-hidden">
          {searchable && (
            <div className="flex items-center gap-2 px-3 py-2 border-b border-border">
              <Search size={14} className="text-ink-muted" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                autoFocus
                placeholder="Search…"
                className="flex-1 bg-transparent text-sm outline-none"
              />
            </div>
          )}
          <div className="max-h-64 overflow-y-auto py-1">
            {filtered.length === 0 ? (
              <div className="px-3 py-3 text-sm text-ink-muted">{emptyLabel}</div>
            ) : (
              filtered.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  onClick={() => {
                    onChange?.(o.value, o);
                    setOpen(false);
                    setQ('');
                  }}
                  className={cn(
                    'w-full flex items-start gap-2 px-3 py-2 text-left text-sm hover:bg-surface-2',
                    selected?.value === o.value && 'bg-accent-light',
                  )}
                >
                  <span className="flex-1">
                    <span className="block font-medium text-ink">{o.label}</span>
                    {o.description && (
                      <span className="block text-xs text-ink-muted">{o.description}</span>
                    )}
                  </span>
                  {selected?.value === o.value && (
                    <Check size={16} className="text-accent shrink-0 mt-0.5" />
                  )}
                </button>
              ))
            )}
          </div>
        </div>
      )}

      {error ? (
        <p className="text-xs text-error">{error}</p>
      ) : hint ? (
        <p className="text-xs text-ink-muted">{hint}</p>
      ) : null}
    </div>
  );
}
