import { useEffect, useMemo, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import { cn } from '../../utils/cn.js';

const TYPE_TONE = {
  asset: 'bg-accent-light text-accent',
  liability: 'bg-warning-light text-warning',
  equity: 'bg-surface-2 text-ink-muted',
  revenue: 'bg-success-light text-success',
  expense: 'bg-error-light text-error',
};

// Searchable dropdown over the chart of accounts. Groups by account type so a
// big COA stays scannable.
export default function AccountSelector({
  accounts = [],
  value = null,
  onChange,
  placeholder = 'Select account…',
  className = '',
  disabledTypes = [],
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const ref = useRef(null);
  const selected = useMemo(
    () => accounts.find((a) => a.id === value) || null,
    [accounts, value],
  );

  useEffect(() => {
    function handler(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    if (open) {
      document.addEventListener('mousedown', handler);
      return () => document.removeEventListener('mousedown', handler);
    }
    return undefined;
  }, [open]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return accounts
      .filter((a) => a.isActive !== false)
      .filter((a) => !disabledTypes.includes(a.type))
      .filter(
        (a) =>
          !q ||
          a.code.toLowerCase().includes(q) ||
          a.name.toLowerCase().includes(q),
      );
  }, [accounts, search, disabledTypes]);

  const grouped = useMemo(() => {
    const order = ['asset', 'liability', 'equity', 'revenue', 'expense'];
    const groups = order.map((t) => ({
      type: t,
      items: filtered.filter((a) => a.type === t),
    }));
    return groups.filter((g) => g.items.length > 0);
  }, [filtered]);

  return (
    <div ref={ref} className={cn('relative', className)}>
      <button
        type="button"
        className={cn(
          'h-10 w-full rounded-md border border-border bg-surface px-3',
          'text-left text-sm flex items-center gap-2',
          'hover:border-ink-muted focus:outline-none focus:border-accent',
        )}
        onClick={() => setOpen((v) => !v)}
      >
        {selected ? (
          <>
            <span className="font-mono text-xs text-ink-muted">{selected.code}</span>
            <span className="truncate">{selected.name}</span>
            <span
              className={cn(
                'ml-auto text-[10px] uppercase tracking-wide rounded-full px-1.5 py-0.5',
                TYPE_TONE[selected.type],
              )}
            >
              {selected.type}
            </span>
          </>
        ) : (
          <span className="text-ink-muted">{placeholder}</span>
        )}
      </button>
      {open && (
        <div className="absolute z-50 mt-1 w-full rounded-card border border-border bg-surface shadow-lg max-h-72 overflow-y-auto">
          <div className="sticky top-0 bg-surface border-b border-border p-2">
            <div className="relative">
              <Search className="absolute left-2 top-2 h-4 w-4 text-ink-muted" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search code or name…"
                className="w-full h-8 pl-7 pr-2 text-sm rounded-md border border-border bg-surface focus:outline-none focus:border-accent"
                autoFocus
              />
            </div>
          </div>
          {grouped.length === 0 ? (
            <div className="p-3 text-sm text-ink-muted">No accounts match.</div>
          ) : (
            grouped.map((g) => (
              <div key={g.type} className="py-1">
                <div className="px-3 py-1 text-[10px] uppercase tracking-wide text-ink-muted">
                  {g.type}
                </div>
                {g.items.map((a) => (
                  <button
                    key={a.id}
                    type="button"
                    className={cn(
                      'w-full px-3 py-1.5 text-left text-sm flex items-center gap-2 hover:bg-surface-2',
                      value === a.id && 'bg-accent-light',
                    )}
                    onClick={() => {
                      onChange(a.id, a);
                      setOpen(false);
                      setSearch('');
                    }}
                  >
                    <span className="font-mono text-xs text-ink-muted w-12">
                      {a.code}
                    </span>
                    <span className="truncate">{a.name}</span>
                  </button>
                ))}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
