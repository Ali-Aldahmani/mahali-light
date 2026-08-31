import { useEffect, useRef, useState } from 'react';
import { Search, FileText, User, Phone, Barcode, Package } from 'lucide-react';
import Input from '../ui/Input.jsx';
import { lookupReturnTransaction } from '../../services/returnService.js';

const MODES = [
  { value: 'invoice', label: 'Invoice', icon: FileText, placeholder: 'INV-2026-...' },
  { value: 'customer', label: 'Customer', icon: User, placeholder: 'Mohammed' },
  { value: 'phone', label: 'Phone', icon: Phone, placeholder: '+971...' },
  { value: 'serial', label: 'Serial', icon: Barcode, placeholder: 'SN-...' },
  { value: 'product', label: 'Product', icon: Package, placeholder: 'LED Bulb 9W' },
];

export default function ReturnLookupSearch({
  onResults,
  onSelect,
  autoFocus = true,
}) {
  const [mode, setMode] = useState('invoice');
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const inputRef = useRef(null);
  const debounceRef = useRef(null);

  useEffect(() => {
    if (autoFocus) {
      const t = setTimeout(() => inputRef.current?.focus(), 50);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [autoFocus]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!q || q.trim().length < 2) {
      setResults([]);
      setError(null);
      if (onResults) onResults([]);
      return undefined;
    }
    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        const data = await lookupReturnTransaction({ q, mode });
        setResults(data || []);
        if (onResults) onResults(data || []);
      } catch (err) {
        setError(err?.message || 'Search failed.');
      } finally {
        setLoading(false);
      }
    }, 250);
    return () => clearTimeout(debounceRef.current);
  }, [q, mode, onResults]);

  const activeMode = MODES.find((m) => m.value === mode);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-1">
        {MODES.map((m) => {
          const Icon = m.icon;
          const active = m.value === mode;
          return (
            <button
              key={m.value}
              type="button"
              onClick={() => setMode(m.value)}
              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition ${
                active
                  ? 'bg-accent-light text-accent'
                  : 'bg-surface-2 text-ink-muted hover:text-ink'
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              {m.label}
            </button>
          );
        })}
      </div>

      <Input
        ref={inputRef}
        leftIcon={<Search className="h-4 w-4" />}
        placeholder={`Search by ${activeMode?.label?.toLowerCase() || 'anything'} (e.g. ${activeMode?.placeholder})`}
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />

      {error && (
        <div className="rounded-lg border border-error/30 bg-error-light p-3 text-sm text-error">
          {error}
        </div>
      )}

      <div className="space-y-2">
        {loading && (
          <div className="rounded-lg bg-surface-2 p-3 text-sm text-ink-muted">
            Searching…
          </div>
        )}
        {!loading && q.trim().length >= 2 && results.length === 0 && !error && (
          <div className="rounded-lg bg-surface-2 p-3 text-sm text-ink-muted">
            No matching invoices found. Consider a no-invoice return (requires
            manager approval).
          </div>
        )}
        {results.map((inv) => (
          <button
            key={inv.id}
            type="button"
            onClick={() => onSelect?.(inv)}
            className="block w-full rounded-lg border border-border bg-surface p-3 text-left transition hover:border-accent hover:bg-accent-light"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="font-mono text-sm font-semibold text-ink">
                {inv.invoiceNumber}
              </div>
              <div className="text-xs text-ink-muted">
                {new Date(inv.createdAt).toLocaleDateString('en-GB', {
                  day: '2-digit',
                  month: 'short',
                  year: 'numeric',
                })}
              </div>
            </div>
            <div className="mt-1 text-sm text-ink">
              {inv.customerName || 'Walk-in customer'}
              {inv.customerPhone && (
                <span className="text-ink-muted"> · {inv.customerPhone}</span>
              )}
            </div>
            <div className="mt-1 text-xs text-ink-muted">
              {inv.items?.length || 0} item{inv.items?.length === 1 ? '' : 's'} ·
              Total{' '}
              <span className="font-medium text-ink">
                AED {Number(inv.total).toFixed(2)}
              </span>
              {inv.hasReturn && (
                <span className="ml-2 rounded-full bg-warning-light px-2 py-0.5 text-warning">
                  Has prior return
                </span>
              )}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
