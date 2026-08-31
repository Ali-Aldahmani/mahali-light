import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Plus, ArrowLeft, CheckCircle2, AlertCircle } from 'lucide-react';
import PageHeader from '../../components/ui/PageHeader.jsx';
import Button from '../../components/ui/Button.jsx';
import Input from '../../components/ui/Input.jsx';
import Spinner from '../../components/ui/Spinner.jsx';
import EmptyState from '../../components/ui/EmptyState.jsx';
import JournalEntryTable from '../../components/ui/JournalEntryTable.jsx';
import ManualJournalEntrySlideOver from './ManualJournalEntrySlideOver.jsx';
import { useAuthStore } from '../../store/authStore.js';
import {
  listJournal,
  getJournalEntry,
} from '../../services/financeService.js';
import { formatDate, formatCurrency } from '../../utils/format.js';
import { toast } from '../../store/toastStore.js';

export default function JournalPage() {
  const navigate = useNavigate();
  const { id } = useParams();
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const canPost = hasPermission('finance.close_period');

  const [rows, setRows] = useState([]);
  const [meta, setMeta] = useState({ page: 1, limit: 25, total: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filters, setFilters] = useState({
    from: '',
    to: '',
    referenceType: '',
    isManual: '',
  });
  const [showManual, setShowManual] = useState(false);

  // Detail (when /finance/journal/:id is open via the detail route).
  const [detail, setDetail] = useState(null);
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
      .then((resp) => {
        setRows(resp.data || []);
        setMeta(resp.meta || meta);
        setError(null);
      })
      .catch((err) => setError(err?.message || 'Failed to load journal.'))
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
      .catch((err) => toast.error(err?.message || 'Could not load entry.'))
      .finally(() => setDetailLoading(false));
  }, [id]);

  if (id) {
    return (
      <div className="space-y-4">
        <PageHeader
          title={detail?.entryNumber || 'Journal Entry'}
          subtitle={detail?.description || ''}
          action={
            <Link to="/finance/journal">
              <Button variant="secondary" size="sm" leftIcon={<ArrowLeft size={14} />}>
                Back to journal
              </Button>
            </Link>
          }
        />
        {detailLoading && <Spinner />}
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
        <Input
          type="date"
          value={filters.from}
          onChange={(e) => setFilters((f) => ({ ...f, from: e.target.value }))}
          placeholder="From"
        />
        <Input
          type="date"
          value={filters.to}
          onChange={(e) => setFilters((f) => ({ ...f, to: e.target.value }))}
          placeholder="To"
        />
        <select
          value={filters.referenceType}
          onChange={(e) =>
            setFilters((f) => ({ ...f, referenceType: e.target.value }))
          }
          className="h-10 px-3 rounded-md border border-border bg-surface text-sm"
        >
          <option value="">All sources</option>
          <option value="invoice">Invoice</option>
          <option value="customer_payment">Customer payment</option>
          <option value="purchase_order">Purchase order</option>
          <option value="supplier_payment">Supplier payment</option>
          <option value="bill_payment">Bill payment</option>
          <option value="expense">Expense</option>
          <option value="return_order">Return order</option>
          <option value="stock_movement">Stock movement</option>
          <option value="manual">Manual</option>
        </select>
        <select
          value={filters.isManual}
          onChange={(e) => setFilters((f) => ({ ...f, isManual: e.target.value }))}
          className="h-10 px-3 rounded-md border border-border bg-surface text-sm"
        >
          <option value="">Auto + manual</option>
          <option value="true">Manual only</option>
          <option value="false">Auto only</option>
        </select>
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
        <div className="flex items-center justify-center py-12">
          <Spinner />
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
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.id}
                  className="border-b border-border last:border-b-0 hover:bg-surface-2 cursor-pointer"
                  onClick={() => navigate(`/finance/journal/${r.id}`)}
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
          <div className="flex gap-2">
            <Button
              variant="secondary"
              size="sm"
              disabled={meta.page <= 1}
              onClick={() => fetchList(meta.page - 1)}
            >
              Previous
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={meta.page * meta.limit >= meta.total}
              onClick={() => fetchList(meta.page + 1)}
            >
              Next
            </Button>
          </div>
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

function Meta({ label, value }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-ink-muted">{label}</div>
      <div className="mt-1">{value}</div>
    </div>
  );
}
