import { useEffect, useRef, useState } from 'react';
import { Search, User, X } from 'lucide-react';
import Input from './Input.jsx';
import { useDebouncedValue } from '../../hooks/useDebouncedValue.js';
import { searchCustomers } from '../../services/customerService.js';
import { formatCurrency } from '../../utils/format.js';
import CustomerAvatar from './CustomerAvatar.jsx';

// Small LRU-ish cache keyed by lowercased query. POS uses this every time a
// customer is added to an invoice, so we keep the hottest 25 queries in
// memory. The cache is cleared when the page reloads — that's intentional
// because authoritative balances live on the server.
const SEARCH_CACHE = new Map();
const CACHE_LIMIT = 25;
const CACHE_TTL_MS = 30_000;

function cacheGet(key) {
  const hit = SEARCH_CACHE.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > CACHE_TTL_MS) {
    SEARCH_CACHE.delete(key);
    return null;
  }
  return hit.value;
}

function cacheSet(key, value) {
  SEARCH_CACHE.set(key, { value, at: Date.now() });
  if (SEARCH_CACHE.size > CACHE_LIMIT) {
    // Drop the oldest entry.
    const first = SEARCH_CACHE.keys().next().value;
    if (first) SEARCH_CACHE.delete(first);
  }
}

export default function CustomerSelect({
  label = 'Customer',
  placeholder = 'Search by name, phone or company',
  value = null,
  onChange,
  allowGuest = true,
  showBalance = true,
  required = false,
  disabled = false,
  autoFocus = false,
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  const containerRef = useRef(null);
  const debounced = useDebouncedValue(query, 200);

  useEffect(() => {
    let aborted = false;
    const key = (debounced || '').trim().toLowerCase();
    if (!key) {
      setResults([]);
      return undefined;
    }
    const cached = cacheGet(key);
    if (cached) {
      setResults(cached);
      return undefined;
    }
    searchCustomers(key)
      .then((data) => {
        if (aborted) return;
        const list = data || [];
        cacheSet(key, list);
        setResults(list);
      })
      .catch(() => {
        if (!aborted) setResults([]);
      });
    return () => {
      aborted = true;
    };
  }, [debounced]);

  useEffect(() => {
    const onClick = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  function pick(customer) {
    onChange?.(customer);
    setQuery('');
    setOpen(false);
  }

  function clear() {
    onChange?.(null);
    setQuery('');
  }

  const isGuest = value && value.id === null;
  const display = value
    ? isGuest
      ? 'Guest (no account)'
      : value.name
    : null;

  return (
    <div ref={containerRef} className="relative">
      {value ? (
        <div>
          {label && (
            <label className="text-sm font-medium text-ink mb-1.5 block">
              {label}
              {required && <span className="text-error ml-0.5">*</span>}
            </label>
          )}
          <div className="flex items-center justify-between rounded-input border border-border bg-surface-2 px-3 py-2">
            <div className="flex items-center gap-2 min-w-0">
              {isGuest ? (
                <div className="h-9 w-9 rounded-full bg-surface inline-flex items-center justify-center text-ink-muted">
                  <User size={16} />
                </div>
              ) : (
                <CustomerAvatar customer={value} size="sm" />
              )}
              <div className="min-w-0">
                <div className="text-sm font-medium text-ink truncate">
                  {display}
                </div>
                {!isGuest && (
                  <div className="text-xs text-ink-muted truncate">
                    {value.phone || value.companyName || '—'}
                    {showBalance && value.creditBalance > 0 && (
                      <span className="ml-2 text-accent">
                        owes {formatCurrency(value.creditBalance)}
                      </span>
                    )}
                  </div>
                )}
              </div>
            </div>
            {!disabled && (
              <button
                type="button"
                onClick={clear}
                className="ml-2 inline-flex h-7 w-7 items-center justify-center rounded-full text-ink-muted hover:bg-surface"
                aria-label="Clear customer"
              >
                <X size={14} />
              </button>
            )}
          </div>
        </div>
      ) : (
        <Input
          label={label}
          required={required}
          disabled={disabled}
          autoFocus={autoFocus}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          placeholder={placeholder}
          leftIcon={<Search size={16} />}
        />
      )}

      {!value && open && (results.length > 0 || allowGuest) && (
        <div className="absolute z-30 mt-1 w-full max-h-72 overflow-auto rounded-input border border-border bg-surface shadow-pop">
          {allowGuest && (
            <button
              type="button"
              onClick={() => pick({ id: null, name: 'Guest' })}
              className="w-full flex items-center gap-2 px-3 py-2 hover:bg-surface-2 text-left border-b border-border"
            >
              <div className="h-8 w-8 rounded-full bg-surface-2 inline-flex items-center justify-center text-ink-muted">
                <User size={14} />
              </div>
              <div className="min-w-0">
                <div className="text-sm font-medium text-ink">Guest (no account)</div>
                <div className="text-xs text-ink-muted">
                  Quick sale without recording a customer
                </div>
              </div>
            </button>
          )}
          {results.map((c) => (
            <button
              type="button"
              key={c.id}
              onClick={() => pick(c)}
              className="w-full flex items-center gap-2 px-3 py-2 hover:bg-surface-2 text-left"
            >
              <CustomerAvatar customer={c} size="sm" />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium text-ink truncate">
                  {c.name}
                  {c.companyName && (
                    <span className="text-ink-muted"> · {c.companyName}</span>
                  )}
                </div>
                <div className="text-xs text-ink-muted truncate">
                  {c.phone || '—'}
                </div>
              </div>
              {showBalance && c.creditBalance > 0 && (
                <div className="text-xs text-accent shrink-0">
                  {formatCurrency(c.creditBalance)}
                </div>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
