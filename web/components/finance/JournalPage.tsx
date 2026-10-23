'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { Plus, ArrowLeft, CheckCircle2, AlertCircle, Eye } from 'lucide-react';
import PageHeader from '@/components/ui/PageHeader';
import Button from '@/components/ui/Button';
import Skeleton from '@/components/ui/skeleton';
import EmptyState from '@/components/ui/EmptyState';
import JournalEntryTable from '@/components/ui/JournalEntryTable';
import ManualJournalEntrySlideOver from '@/components/finance/ManualJournalEntrySlideOver';
import { useAuthStore } from '@/store/authStore';
import { listJournal, getJournalEntry } from '@/services/financeService';
import { formatDate, formatCurrency } from '@/lib/utils/format';
import { toast } from '@/store/toastStore';
import Select from '@/components/ui/Select';
import Pagination from '@/components/ui/pagination/Pagination';
import DateRangeField from '@/components/ui/DateRangeField';
import RowActions from '@/components/ui/RowActions';

export default function JournalPage() {
  const router = useRouter();
  const { id } = useParams<{ id?: string }>();
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const canPost = hasPermission('finance.close_period');

  const [rows, setRows] = useState<any[]>([]);
  const [meta, setMeta] = useState<any>({ page: 1, limit: 25, total: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState({
    from: '',
    to: '',
    referenceType: '',
    isManual: '',
  });
  const [showManual, setShowManual] = useState(false);

  // Detail (when /finance/journal/:id is open via the detail route).
  const [detail, setDetail] = useState<any>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  function fetchList(page = 1) {
    setLoading(true);
    listJournal({
      page,
      limit: meta.limit,
      from: filters.from || undefined,
      to: filters.to || undefined,
      referenceType: filters.referenceType || undefined,
      isManual: filters.isManual || undefined,
    })
      .then((resp: any) => {
        setRows(resp.data || []);
        setMeta(resp.meta || meta);
        setError(null);
      })
      .catch((err: any) => setError(err?.message || 'Failed to load journal.'))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    fetchList(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters]);

  useEffect(() => {
    if (!id) {
      setDetail(null);
      return;
    }
    setDetailLoading(true);
    getJournalEntry(id)
      .then(setDetail)
      .catch((err: any) => toast.error(err?.message || 'Could not load entry.'))
      .finally(() => setDetailLoading(false));
  }, [id]);

  if (id) {
    return (
      <div className="space-y-4">
        <PageHeader
          title={detail?.entryNumber || 'Journal Entry'}
          subtitle={detail?.description || ''}
          action={
            <Link href="/finance/journal">
              <Button variant="secondary" size="sm" leftIcon={<ArrowLeft size={14} />}>
                Back to journal
              </Button>
            </Link>
          }
        />
        {detailLoading && <Skeleton lines={5} className="rounded-card border border-border bg-surface p-5" />}
        {detail && (
          <>
            <div className="rounded-card border border-border bg-surface p-4 grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
              <Meta label="Date" value={formatDate(detail.date)} />
              <Meta label="Period" value={detail.periodName} />
              <Meta label="Reference" value={detail.referenceType || '—'} />
              <Meta
                label="Posted by"
                value={detail.createdByUsername || '—'}
              />
              <Meta
                label="Is manual"
                value={detail.isManual ? 'Yes' : 'Auto-posted'}
              />
              <Meta
                label="Status"
                value={
                  <span
                    className={
                      detail.balanced ? 'text-success inline-flex items-center gap-1' : 'text-error inline-flex items-center gap-1'
                    }
                  >
                    {detail.balanced ? (
                      <CheckCircle2 className="h-4 w-4" />
                    ) : (
                      <AlertCircle className="h-4 w-4" />
                    )}
                    {detail.balanced ? 'Balanced' : 'Out of balance'}
                  </span>
                }
              />
              <Meta label="Total debit" value={formatCurrency(detail.totalDebit)} />
              <Meta label="Total credit" value={formatCurrency(detail.totalCredit)} />
            </div>
            <JournalEntryTable lines={detail.lines || []} />
          </>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Journal entries"
        subtitle="Double-entry ledger of every transaction."
        action={
          canPost && (
            <Button
              leftIcon={<Plus size={16} />}
              onClick={() => setShowManual(true)}
            >
              Post manual entry
            </Button>
          )
        }
      />

      <div className="rounded-card border border-border bg-surface p-3 grid grid-cols-2 md:grid-cols-5 gap-2">
        <DateRangeField
          label="Entry dates"
          className="md:col-span-2"
          from={filters.from}
          to={filters.to}
          onChange={({ from, to }) => setFilters((f) => ({ ...f, from, to }))}
        />
        <Select
          containerClassName="w-48"
          value={filters.referenceType}
          onChange={(v) => setFilters((f) => ({ ...f, referenceType: v }))}
          options={[
            { value: '', label: 'All sources' },
            { value: 'invoice', label: 'Invoice' },
            { value: 'customer_payment', label: 'Customer payment' },
            { value: 'purchase_order', label: 'Purchase order' },
            { value: 'supplier_payment', label: 'Supplier payment' },
            { value: 'bill_payment', label: 'Bill payment' },
            { value: 'expense', label: 'Expense' },
            { value: 'return_order', label: 'Return order' },
            { value: 'stock_movement', label: 'Stock movement' },
            { value: 'manual', label: 'Manual' },
          ]}
        />
        <Select
          containerClassName="w-40"
          value={filters.isManual}
          onChange={(v) => setFilters((f) => ({ ...f, isManual: v }))}
          options={[
            { value: '', label: 'Auto + manual' },
            { value: 'true', label: 'Manual only' },
            { value: 'false', label: 'Auto only' },
          ]}
        />
        <Button
          variant="secondary"
          onClick={() =>
            setFilters({ from: '', to: '', referenceType: '', isManual: '' })
          }
        >
          Reset
        </Button>
      </div>

      {loading && (
        <div className="py-4">
          <Skeleton lines={4} />
        </div>
      )}
      {error && !loading && (
        <EmptyState title="Could not load journal" description={error} />
      )}
      {!loading && !error && rows.length === 0 && (
        <EmptyState
          title="No journal entries"
          description="Entries will appear here as transactions happen."
        />
      )}
      {!loading && rows.length > 0 && (
        <div className="rounded-card border border-border bg-surface overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border bg-surface-2 text-xs uppercase tracking-wide text-ink-muted">
                <th className="text-left py-2 px-3">Entry #</th>
                <th className="text-left py-2 px-3">Date</th>
                <th className="text-left py-2 px-3">Description</th>
                <th className="text-left py-2 px-3">Source</th>
                <th className="text-right py-2 px-3">Lines</th>
                <th className="text-right py-2 px-3">Total</th>
                <th className="py-2 px-3">Balanced</th>
                <th className="py-2 px-3" aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.id}
                  className="border-b border-border last:border-b-0"
                >
                  <td className="py-2 px-3 text-sm font-mono">{r.entryNumber}</td>
                  <td className="py-2 px-3 text-sm">{formatDate(r.date)}</td>
                  <td className="py-2 px-3 text-sm">
                    <div className="line-clamp-1">{r.description}</div>
                    {r.isManual && (
                      <span className="text-[10px] uppercase tracking-wide text-accent">
                        Manual
                      </span>
                    )}
                  </td>
                  <td className="py-2 px-3 text-sm text-ink-muted">
                    {r.referenceType || '—'}
                  </td>
                  <td className="py-2 px-3 text-sm text-right">{r.lineCount}</td>
                  <td className="py-2 px-3 text-sm text-right font-mono">
                    {formatCurrency(r.totalDebit)}
                  </td>
                  <td className="py-2 px-3 text-center">
                    {r.balanced ? (
                      <CheckCircle2 className="h-4 w-4 text-success inline" />
                    ) : (
                      <AlertCircle className="h-4 w-4 text-error inline" />
                    )}
                  </td>
                  <td className="py-2 px-3">
                    <RowActions
                      label="Journal entry actions"
                      actions={[{ id: 'view', label: 'View', icon: <Eye />, onClick: () => router.push(`/finance/journal/${r.id}`) }]}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {meta.total > meta.limit && (
        <div className="flex items-center justify-between text-sm text-ink-muted">
          <span>
            Page {meta.page} · {meta.total} total
          </span>
          <Pagination
            page={meta.page}
            pageCount={Math.ceil(meta.total / meta.limit)}
            onPageChange={(next) => fetchList(next)}
          />
        </div>
      )}

      <ManualJournalEntrySlideOver
        open={showManual}
        onClose={() => setShowManual(false)}
        onPosted={() => {
          setShowManual(false);
          fetchList(1);
        }}
      />
    </div>
  );
}

function Meta({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-ink-muted">{label}</div>
      <div className="mt-1">{value}</div>
    </div>
  );
}
