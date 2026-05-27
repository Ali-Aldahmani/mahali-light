import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search } from 'lucide-react';
import { globalSearch } from '../../services/searchService.js';
import { addBreadcrumb } from '../../services/breadcrumbService.js';

const ROUTES = {
  products: (r) => `/products/${r.id}`,
  customers: (r) => `/customers/${r.id}`,
  invoices: (r) => `/invoices/${r.id}`,
  suppliers: (r) => `/suppliers/${r.id}`,
  employees: (r) => `/employees`,
  purchase_orders: (r) => `/purchase-orders/${r.id}`,
  warranties: (r) => `/warranties/${r.id}`,
  returns: (r) => `/returns/requests/${r.id}`,
};

export default function GlobalSearchBar() {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [data, setData] = useState(null);
  const timer = useRef(null);
  const navigate = useNavigate();

  useEffect(() => {
    const onKey = (e) => {
      if (e.ctrlKey && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        document.getElementById('global-search-input')?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    if (!q.trim()) {
      setData(null);
      return undefined;
    }
    timer.current = setTimeout(async () => {
      try {
        const res = await globalSearch(q.trim());
        setData(res);
        addBreadcrumb('search', { q: q.trim() });
      } catch (_e) {
        setData(null);
      }
    }, 250);
    return () => clearTimeout(timer.current);
  }, [q]);

  const groups = data
    ? Object.entries(data).filter(([, arr]) => arr?.length)
    : [];

  return (
    <div className="relative w-full max-w-md">
      <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-muted" />
      <input
        id="global-search-input"
        type="search"
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 200)}
        placeholder="Search… (Ctrl+F)"
        className="h-9 w-full rounded-lg border border-border bg-surface pl-9 pr-3 text-sm"
      />
      {open && q.trim() && groups.length > 0 && (
        <div className="absolute left-0 right-0 top-full z-50 mt-1 max-h-80 overflow-auto rounded-card border border-border bg-surface shadow-pop">
          {groups.map(([type, items]) => (
            <div key={type} className="border-b border-border p-2 last:border-0">
              <p className="px-2 py-1 text-xs font-semibold uppercase text-ink-muted">{type.replace('_', ' ')}</p>
              {items.slice(0, 3).map((row) => (
                <button
                  key={row.id}
                  type="button"
                  className="block w-full rounded-md px-2 py-1.5 text-left text-sm hover:bg-surface-2"
                  onMouseDown={() => {
                    const to = ROUTES[type]?.(row);
                    if (to) navigate(to);
                    setOpen(false);
                    setQ('');
                  }}
                >
                  {row.name || row.invoice_number || row.request_number || row.warranty_number || row.po_number || row.sku}
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
