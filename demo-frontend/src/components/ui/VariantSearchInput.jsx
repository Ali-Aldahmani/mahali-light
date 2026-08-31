import { useEffect, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import { useDebouncedValue } from '../../hooks/useDebouncedValue.js';
import { searchProducts } from '../../services/productService.js';
import Input from './Input.jsx';
import { fileUrl } from '../../config.js';

// Searchable picker for product variants. Returns the chosen variant via
// onSelect. Optional `defaultVariant` for slide-overs opened from a row.
export default function VariantSearchInput({
  label = 'Product',
  placeholder = 'Search by name, SKU, or barcode',
  onSelect,
  defaultVariant = null,
  autoFocus = false,
}) {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(defaultVariant);
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  const containerRef = useRef(null);
  const debounced = useDebouncedValue(query, 250);

  useEffect(() => {
    let aborted = false;
    if (!debounced || debounced.length < 1) {
      setResults([]);
      return;
    }
    searchProducts(debounced)
      .then((res) => {
        if (!aborted) setResults(res || []);
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

  function pick(variant) {
    setSelected(variant);
    setQuery('');
    setOpen(false);
    onSelect?.(variant);
  }

  return (
    <div ref={containerRef} className="relative">
      <Input
        label={label}
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

      {selected && (
        <div className="mt-2 flex items-center gap-3 rounded-input border border-border bg-surface-2 px-3 py-2">
          <div className="h-8 w-8 rounded bg-surface overflow-hidden flex items-center justify-center text-xs text-ink-muted">
            {selected.imagePath || selected.productImage ? (
              <img
                src={fileUrl(selected.imagePath || selected.productImage)}
                alt=""
                className="h-full w-full object-cover"
              />
            ) : (
              '—'
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium text-ink truncate">
              {selected.productName}
            </div>
            <div className="text-xs text-ink-muted truncate">
              SKU: {selected.sku} · {selected.barcode || selected.internalBarcode}
            </div>
          </div>
        </div>
      )}

      {open && results.length > 0 && (
        <div className="absolute z-30 mt-1 w-full max-h-72 overflow-auto rounded-input border border-border bg-surface shadow-pop">
          {results.map((r) => (
            <button
              type="button"
              key={r.variantId}
              onClick={() => pick(r)}
              className="w-full flex items-center gap-3 px-3 py-2 hover:bg-surface-2 text-left"
            >
              <div className="h-8 w-8 rounded bg-surface-2 overflow-hidden flex items-center justify-center text-xs text-ink-muted shrink-0">
                {r.imagePath ? (
                  <img
                    src={fileUrl(r.imagePath)}
                    alt=""
                    className="h-full w-full object-cover"
                  />
                ) : (
                  '—'
                )}
              </div>
              <div className="min-w-0">
                <div className="text-sm font-medium text-ink truncate">
                  {r.productName}
                </div>
                <div className="text-xs text-ink-muted truncate">
                  SKU: {r.sku} · {r.barcode || r.internalBarcode}
                </div>
              </div>
              <div className="ml-auto text-xs text-ink-muted shrink-0">
                Stock: {r.stockQty ?? 0} {r.unitLabel || ''}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
