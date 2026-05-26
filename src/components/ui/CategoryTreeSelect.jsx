import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, ChevronRight, Folder, Search } from 'lucide-react';
import { cn } from '../../utils/cn.js';

// Renders a category tree as a single-select dropdown.
// Props:
//   tree: full categories tree as returned by /api/categories
//   value: selected category id
//   onChange: (id, category)
//   allowNone: render an "All categories" / "None" entry
//   noneLabel: text for that entry
export default function CategoryTreeSelect({
  label,
  tree = [],
  value = null,
  onChange,
  allowNone = false,
  noneLabel = 'All categories',
  placeholder = 'Select a category…',
  error,
  hint,
  required = false,
  disabled = false,
  className = '',
  containerClassName = '',
}) {
  const id = useId();
  const ref = useRef(null);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [expanded, setExpanded] = useState(() => new Set());

  // Flatten for searching / breadcrumb lookup.
  const { flat, byId } = useMemo(() => {
    const flat = [];
    const byId = new Map();
    function walk(nodes, parents) {
      for (const n of nodes) {
        const path = [...parents, n.name];
        const entry = {
          id: n.id,
          name: n.name,
          parentId: n.parentId,
          depth: parents.length,
          path: path.join(' > '),
          node: n,
        };
        flat.push(entry);
        byId.set(n.id, entry);
        if (n.children?.length) walk(n.children, path);
      }
    }
    walk(tree || [], []);
    return { flat, byId };
  }, [tree]);

  const selected = value ? byId.get(value) : null;

  useEffect(() => {
    function handle(e) {
      if (ref.current && !ref.current.contains(e.target)) {
        setOpen(false);
        setQ('');
      }
    }
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, []);

  function toggle(nodeId) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(nodeId)) next.delete(nodeId);
      else next.add(nodeId);
      return next;
    });
  }

  function selectNode(node) {
    onChange?.(node.id, node);
    setOpen(false);
    setQ('');
  }

  const filtered = useMemo(() => {
    if (!q.trim()) return null;
    const term = q.trim().toLowerCase();
    return flat.filter(
      (n) =>
        n.name.toLowerCase().includes(term) || n.path.toLowerCase().includes(term),
    );
  }, [q, flat]);

  function renderTree(nodes, depth = 0) {
    return nodes.map((n) => {
      const hasChildren = n.children && n.children.length > 0;
      const isOpen = expanded.has(n.id);
      const isSelected = value === n.id;
      return (
        <div key={n.id}>
          <div
            className={cn(
              'flex items-center gap-1 pl-2 pr-3 py-1.5 text-sm rounded-md hover:bg-surface-2',
              isSelected && 'bg-accent-light text-accent font-medium',
            )}
            style={{ paddingLeft: 8 + depth * 16 }}
          >
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                if (hasChildren) toggle(n.id);
              }}
              className={cn(
                'inline-flex h-5 w-5 items-center justify-center text-ink-muted',
                !hasChildren && 'opacity-0 pointer-events-none',
              )}
              tabIndex={-1}
            >
              {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            </button>
            <button
              type="button"
              onClick={() => selectNode(n)}
              className="flex-1 inline-flex items-center gap-2 text-left"
            >
              <Folder size={13} className="text-ink-muted shrink-0" />
              <span className="truncate">{n.name}</span>
              {isSelected && <Check size={14} className="ml-auto text-accent shrink-0" />}
            </button>
          </div>
          {hasChildren && isOpen && renderTree(n.children, depth + 1)}
        </div>
      );
    });
  }

  return (
    <div ref={ref} className={cn('relative flex flex-col gap-1.5', containerClassName)}>
      {label && (
        <label htmlFor={id} className="text-sm font-medium text-ink">
          {label}
          {required && <span className="text-error ml-0.5">*</span>}
        </label>
      )}
      <button
        id={id}
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
        <span className={cn('truncate text-left', !selected && 'text-ink-muted')}>
          {selected ? selected.path : placeholder}
        </span>
        <ChevronDown size={16} className="text-ink-muted shrink-0 ml-2" />
      </button>

      {open && (
        <div className="absolute z-30 top-full mt-1 w-full rounded-card border border-border bg-surface shadow-pop overflow-hidden">
          <div className="flex items-center gap-2 px-3 py-2 border-b border-border">
            <Search size={14} className="text-ink-muted" />
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search categories…"
              className="flex-1 bg-transparent text-sm outline-none"
            />
          </div>

          <div className="max-h-72 overflow-y-auto py-1">
            {allowNone && !q && (
              <button
                type="button"
                onClick={() => selectNode({ id: null, name: noneLabel })}
                className={cn(
                  'flex items-center gap-2 px-3 py-2 w-full text-left text-sm hover:bg-surface-2',
                  value === null && 'bg-accent-light text-accent font-medium',
                )}
              >
                <Folder size={13} className="text-ink-muted" />
                {noneLabel}
                {value === null && <Check size={14} className="ml-auto text-accent" />}
              </button>
            )}

            {filtered ? (
              filtered.length === 0 ? (
                <div className="px-3 py-3 text-sm text-ink-muted">No matches</div>
              ) : (
                filtered.map((n) => (
                  <button
                    key={n.id}
                    type="button"
                    onClick={() => selectNode(n)}
                    className={cn(
                      'flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-surface-2',
                      value === n.id && 'bg-accent-light text-accent font-medium',
                    )}
                  >
                    <Folder size={13} className="text-ink-muted shrink-0" />
                    <span className="truncate">{n.path}</span>
                    {value === n.id && <Check size={14} className="ml-auto text-accent" />}
                  </button>
                ))
              )
            ) : tree.length === 0 ? (
              <div className="px-3 py-3 text-sm text-ink-muted">No categories yet</div>
            ) : (
              renderTree(tree)
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
