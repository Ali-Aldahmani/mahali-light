'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ExternalLink, Loader2, PlayCircle, Search } from 'lucide-react';
import Modal from '@/components/ui/Modal';
import Input from '@/components/ui/Input';
import PrintButton from '@/components/ui/PrintButton';
import PermissionGate from '@/components/ui/PermissionGate';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { listInvoices } from '@/services/invoiceService';
import { searchProducts } from '@/services/productService';
import { formatCurrency } from '@/lib/utils/format';
import { cn } from '@/lib/utils/cn';
import Skeleton from '@/components/ui/skeleton';

function useRemoteList<T>(open: boolean, load: () => Promise<T[]>, deps: unknown[]) {
  const [rows, setRows] = useState<T[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    load()
      .then((data) => !cancelled && setRows(data || []))
      .catch((err: any) => !cancelled && setError(err?.message || 'Could not load.'))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, ...deps]);
  return { rows, loading, error };
}

function ListState({ loading, error, empty, emptyText }: { loading: boolean; error: string | null; empty: boolean; emptyText: string }) {
  if (loading) {
    return (
      <div className="py-3">
        <Skeleton lines={3} />
      </div>
    );
  }
  if (error) return <p role="alert" className="py-4 text-center text-sm text-error">{error}</p>;
  if (empty) return <p className="py-4 text-center text-sm text-ink-muted">{emptyText}</p>;
  return null;
}

// ---- Held sales (server drafts created by this user) ---------------------

export function CashierHeldSalesDialog({
  open,
  userId,
  currentDraftId,
  resumingId,
  onClose,
  onResume,
}: {
  open: boolean;
  userId: string | number | null;
  currentDraftId: string | null;
  resumingId: string | null;
  onClose: () => void;
  onResume: (invoiceId: string) => void;
}) {
  const { rows, loading, error } = useRemoteList<any>(
    open,
    async () => (await listInvoices({ status: 'draft', createdBy: userId, limit: 30 })).data,
    [userId],
  );
  return (
    <Modal open={open} onClose={onClose} title="Held sales" subtitle="Drafts you put on hold. Resume one to continue selling." size="md">
      <ListState loading={loading} error={error} empty={!rows.length} emptyText="No held sales." />
      {!loading && !error && rows.length > 0 && (
        <ul className="space-y-2" aria-label="Held sales">
          {rows.map((inv) => {
            const isCurrent = inv.id === currentDraftId;
            return (
              <li key={inv.id}>
                <button
                  type="button"
                  disabled={isCurrent || !!resumingId}
                  onClick={() => onResume(inv.id)}
                  className="flex min-h-14 w-full items-center gap-3 rounded-input border border-border px-3 py-2 text-left hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50"
                >
                  {resumingId === inv.id ? (
                    <Loader2 className="h-5 w-5 shrink-0 animate-spin text-accent" aria-hidden />
                  ) : (
                    <PlayCircle className="h-5 w-5 shrink-0 text-accent" aria-hidden />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-ink">
                      {inv.invoiceNumber} · {inv.customerName || 'Guest'}
                    </span>
                    <span className="block text-xs text-ink-muted">
                      {inv.itemCount ?? 0} line(s) · {new Date(inv.updatedAt || inv.createdAt).toLocaleString()}
                      {isCurrent ? ' · on screen now' : ''}
                    </span>
                  </span>
                  <span className="shrink-0 text-sm font-semibold text-ink">{formatCurrency(inv.total)}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </Modal>
  );
}

// ---- Find invoice ---------------------------------------------------------

export function CashierInvoicesDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [query, setQuery] = useState('');
  const debounced = useDebouncedValue(query, 300);
  useEffect(() => {
    if (open) setQuery('');
  }, [open]);
  const { rows, loading, error } = useRemoteList<any>(
    open,
    async () => (await listInvoices({ search: debounced.trim() || undefined, status: 'confirmed', limit: 20 })).data,
    [debounced],
  );
  return (
    <Modal open={open} onClose={onClose} title="Find invoice" size="lg">
      <div className="space-y-3">
        <Input
          autoFocus
          label="Invoice number, customer name or phone"
          value={query}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setQuery(e.target.value)}
          leftIcon={<Search className="h-4 w-4" />}
          className="h-12 text-base"
        />
        <ListState loading={loading} error={error} empty={!rows.length} emptyText="No invoices found." />
        {!loading && !error && rows.length > 0 && (
          <ul className="max-h-[50vh] space-y-2 overflow-y-auto" aria-label="Invoices">
            {rows.map((inv) => (
              <li key={inv.id} className="flex flex-wrap items-center gap-2 rounded-input border border-border px-3 py-2">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-ink">
                    {inv.invoiceNumber} · {inv.customerName || 'Guest'}
                  </span>
                  <span className="block text-xs text-ink-muted">
                    {new Date(inv.confirmedAt || inv.createdAt).toLocaleString()} · {formatCurrency(inv.total)}
                    {inv.balanceDue > 0 ? ` · due ${formatCurrency(inv.balanceDue)}` : ''}
                  </span>
                </span>
                <PermissionGate permission="invoice.print">
                  <PrintButton invoiceId={inv.id} invoiceNumber={inv.invoiceNumber} kind="receipt" label="Receipt" size="lg" />
                </PermissionGate>
                <Link
                  href={`/invoices/${inv.id}`}
                  className="inline-flex h-11 items-center gap-1 rounded-input border border-border px-3 text-sm text-ink hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                >
                  <ExternalLink className="h-4 w-4" aria-hidden />
                  Open
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  );
}

// ---- Stock check (read-only) ---------------------------------------------

export function CashierStockDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [query, setQuery] = useState('');
  const debounced = useDebouncedValue(query, 250);
  useEffect(() => {
    if (open) setQuery('');
  }, [open]);
  const { rows, loading, error } = useRemoteList<any>(
    open,
    async () => (debounced.trim() ? searchProducts(debounced.trim(), 20) : []),
    [debounced],
  );
  return (
    <Modal open={open} onClose={onClose} title="Stock check" subtitle="Read-only — nothing is added to the sale." size="lg">
      <div className="space-y-3">
        <Input
          autoFocus
          label="Product name, SKU or barcode"
          value={query}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setQuery(e.target.value)}
          leftIcon={<Search className="h-4 w-4" />}
          className="h-12 text-base"
        />
        <ListState
          loading={loading}
          error={error}
          empty={!!debounced.trim() && !rows.length}
          emptyText="No products found."
        />
        {!loading && !error && rows.length > 0 && (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-ink-muted">
                <th className="py-1 font-medium">Product</th>
                <th className="py-1 font-medium">SKU</th>
                <th className="py-1 text-right font-medium">Price</th>
                <th className="py-1 text-right font-medium">In stock</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((v) => {
                const qty = Number(v.stockQty || 0);
                return (
                  <tr key={v.variantId} className="border-t border-border">
                    <td className="py-2 pr-2 text-ink">
                      {v.productName}
                      {v.attributes?.length ? (
                        <span className="block text-xs text-ink-muted">
                          {v.attributes.map((a: any) => `${a.value}${a.unit || ''}`).join(' · ')}
                        </span>
                      ) : null}
                    </td>
                    <td className="py-2 pr-2 text-ink-muted">{v.sku || '—'}</td>
                    <td className="py-2 text-right">{formatCurrency(v.sellingPrice)}</td>
                    <td
                      className={cn(
                        'py-2 text-right font-semibold',
                        qty <= 0 ? 'text-error' : qty <= 5 ? 'text-warning' : 'text-success',
                      )}
                    >
                      {qty} {v.unitLabel || 'pcs'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </Modal>
  );
}
