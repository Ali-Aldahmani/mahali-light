import { useEffect, useRef, useState } from 'react';
import { Search, X } from 'lucide-react';
import Input from './Input.jsx';
import { useDebouncedValue } from '../../hooks/useDebouncedValue.js';
import { listSuppliers } from '../../services/supplierService.js';
import { formatCurrency } from '../../utils/format.js';

// Searchable supplier picker. Returns a supplier shape (id, name, ...).
// Optionally renders the outstanding balance next to each option.
export default function SupplierSelect({
  label = 'Supplier',
  placeholder = 'Search supplier by name or contact',
  value = null,
  onChange,
  showOutstanding = true,
  required = false,
  disabled = false,
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  const containerRef = useRef(null);
  const debounced = useDebouncedValue(query, 200);

  useEffect(() => {
    let aborted = false;
    listSuppliers({ search: debounced, limit: 12, isActive: true })
      .then(({ data }) => {
        if (!aborted) setResults(data || []);
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

  function clear() {
    onChange?.(null);
    setQuery('');
  }

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
            <div className="min-w-0">
              <div className="text-sm font-medium text-ink truncate">
                {value.name}
              </div>
              {showOutstanding && (
                <div className="text-xs text-ink-muted truncate">
                  Outstanding:{' '}
                  <span
                    className={
                      Number(value.outstandingBalance || 0) > 0
                        ? 'text-accent font-medium'
                        : ''
                    }
                  >
                    {formatCurrency(value.outstandingBalance || 0)}
                  </span>
                </div>
              )}
            </div>
            {!disabled && (
              <button
                type="button"
                onClick={clear}
                className="ml-2 inline-flex h-7 w-7 items-center justify-center rounded-full text-ink-muted hover:bg-surface"
                aria-label="Clear supplier"
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

      {!value && open && results.length > 0 && (
        <div className="absolute z-30 mt-1 w-full max-h-72 overflow-auto rounded-input border border-border bg-surface shadow-pop">
          {results.map((s) => (
            <button
              type="button"
              key={s.id}
              onClick={() => {
                onChange?.(s);
                setOpen(false);
                setQuery('');
              }}
              className="w-full flex items-center justify-between gap-3 px-3 py-2 hover:bg-surface-2 text-left"
            >
              <div className="min-w-0">
                <div className="text-sm font-medium text-ink truncate">{s.name}</div>
                {s.contactPerson && (
                  <div className="text-xs text-ink-muted truncate">
                    {s.contactPerson}
                  </div>
                )}
              </div>
              {showOutstanding && (
                <div
                  className={
                    'text-xs shrink-0 ' +
                    (Number(s.outstandingBalance || 0) > 0
                      ? 'text-accent font-medium'
                      : 'text-ink-muted')
                  }
                >
                  {formatCurrency(s.outstandingBalance || 0)}
                </div>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
