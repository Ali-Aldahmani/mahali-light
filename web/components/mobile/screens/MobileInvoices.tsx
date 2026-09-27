'use client';

import { useMemo, useState } from 'react';
import { listInvoices } from '@/services/invoiceService';
import { useMobileQuery } from '@/hooks/useMobileQuery';
import { cn } from '@/lib/utils/cn';
import { formatAed } from '@/lib/mobile/format';
import MobileSortHeader, { nextSort, sortRows, type SortState } from '../MobileSortHeader';
import { MobileCard, MobileEmpty, MobileError, MobileSkeleton } from '../MobileStates';

const PAGE_SIZE = 10;

type InvoiceSortKey = 'invoiceNumber' | 'total' | 'balanceDue' | 'paymentStatus';

const PAYMENT_TONES: Record<string, { label: string; className: string; dot: string }> = {
  paid: { label: 'Paid', className: 'bg-success-light text-success', dot: 'bg-success' },
  partial: { label: 'Partial', className: 'bg-warning-light text-warning', dot: 'bg-warning' },
  unpaid: { label: 'Unpaid', className: 'bg-error-light text-error', dot: 'bg-error' },
};

function PaymentPill({ status }: { status: string }) {
  const tone = PAYMENT_TONES[status] || { label: status || '—', className: 'bg-surface-2 text-ink-muted', dot: 'bg-ink-muted' };
  return (
    <span className={cn('inline-flex h-5 items-center gap-1.5 rounded-full px-2 text-[11px] font-medium', tone.className)}>
      <span aria-hidden className={cn('h-1.5 w-1.5 rounded-full', tone.dot)} />
      {tone.label}
    </span>
  );
}

const GRID = 'grid grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)_minmax(0,1fr)_86px] items-center gap-x-2 px-3';

export default function MobileInvoices() {
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<SortState<InvoiceSortKey>>(null);
  const q = useMobileQuery(() => listInvoices({ page, limit: PAGE_SIZE }), [page]);

  const rows: any[] = (q.data as any)?.data || [];
  const meta = (q.data as any)?.meta || {};
  const total = Number(meta.total || 0);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const first = total ? (page - 1) * PAGE_SIZE + 1 : 0;
  const last = Math.min(page * PAGE_SIZE, total);
  const sorted = useMemo(() => sortRows(rows, sort, (r, k) => r[k]), [rows, sort]);

  return (
    <div className="space-y-4">
      <h1 className="sr-only">Invoices</h1>
      {q.error ? (
        <MobileError message={q.error} onRetry={q.reload} />
      ) : q.loading && !rows.length ? (
        <div role="status" aria-label="Loading invoices" className="space-y-2">
          {[0, 1, 2].map((i) => (
            <MobileSkeleton key={i} className="h-[85px]" />
          ))}
        </div>
      ) : !rows.length ? (
        <MobileEmpty title="No invoices yet" description="Invoices created at the POS will appear here." />
      ) : (
        <MobileCard className="overflow-hidden shadow-card font-m-inter" aria-busy={q.loading}>
          <div role="table" aria-label="Invoices">
            <div role="row" className={cn(GRID, 'bg-surface-2')}>
              <MobileSortHeader label="Invoice" sortKey="invoiceNumber" sort={sort} onSort={(k) => setSort((s) => nextSort(s, k))} />
              <MobileSortHeader label="Total" sortKey="total" sort={sort} onSort={(k) => setSort((s) => nextSort(s, k))} align="right" />
              <MobileSortHeader label="Balance" sortKey="balanceDue" sort={sort} onSort={(k) => setSort((s) => nextSort(s, k))} align="right" />
              <MobileSortHeader label="Payment" sortKey="paymentStatus" sort={sort} onSort={(k) => setSort((s) => nextSort(s, k))} />
            </div>
            {sorted.map((r, i) => (
              <div
                role="row"
                key={r.id}
                className={cn(GRID, 'min-h-[85px] border-t border-border py-3', i % 2 === 1 && 'bg-bg/40')}
              >
                <span role="cell" className="break-all font-mono text-[14px] text-ink">
                  {r.invoiceNumber}
                </span>
                <span role="cell" className="text-right text-[14px] font-medium text-ink">
                  {formatAed(r.total)}
                </span>
                <span
                  role="cell"
                  className={cn('text-right text-[14px]', Number(r.balanceDue) > 0 ? 'font-medium text-accent' : 'text-ink')}
                >
                  {formatAed(r.balanceDue)}
                </span>
                <span role="cell">
                  <PaymentPill status={r.paymentStatus} />
                </span>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-3 py-3 text-[14px] text-ink-muted">
            <span>
              Showing {first}–{last} of {total}
            </span>
            <nav aria-label="Invoice pages" className="flex items-center gap-2">
              <button
                type="button"
                disabled={page <= 1 || q.loading}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="h-11 rounded-input border border-border bg-white px-3 text-ink active:bg-m-field disabled:opacity-40"
              >
                Previous
              </button>
              <span className="whitespace-nowrap">
                Page {page} of {pages}
              </span>
              <button
                type="button"
                disabled={page >= pages || q.loading}
                onClick={() => setPage((p) => Math.min(pages, p + 1))}
                className="h-11 rounded-input border border-border bg-white px-3 text-ink active:bg-m-field disabled:opacity-40"
              >
                Next
              </button>
            </nav>
          </div>
        </MobileCard>
      )}
    </div>
  );
}
