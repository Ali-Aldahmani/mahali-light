import { useEffect, useMemo, useState } from 'react';
import { Trash2, ExternalLink, Plus, Download } from 'lucide-react';
import Table from '../../../components/ui/Table.jsx';
import Button from '../../../components/ui/Button.jsx';
import ExpenseCategoryIcon from '../../../components/ui/ExpenseCategoryIcon.jsx';
import EmptyState from '../../../components/ui/EmptyState.jsx';
import ConfirmDialog from '../../../components/ui/ConfirmDialog.jsx';
import MonthlyExpenseSummary from '../../../components/ui/MonthlyExpenseSummary.jsx';
import {
  listExpenses,
  deleteExpense,
  getExpenseSummary,
} from '../../../services/expenseService.js';
import { listCategories } from '../../../services/expenseCategoryService.js';
import { useAuthStore } from '../../../store/authStore.js';
import { toast } from '../../../store/toastStore.js';
import { fileUrl } from '../../../config.js';

function aed(n) {
  return `AED ${Number(n || 0).toFixed(2)}`;
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function csvEscape(v) {
  if (v == null) return '';
  const s = String(v);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

export default function OneTimeExpensesTab({ refreshTick, onAdd, onMutated }) {
  const hasPermission = useAuthStore((s) => s.hasPermission);

  const [rows, setRows] = useState([]);
  const [meta, setMeta] = useState(null);
  const [loading, setLoading] = useState(false);
  const [categories, setCategories] = useState([]);
  const [summary, setSummary] = useState(null);

  const [categoryId, setCategoryId] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('');
  const [search, setSearch] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(null);

  const now = useMemo(() => new Date(), []);
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());

  useEffect(() => {
    listCategories()
      .then(setCategories)
      .catch(() => setCategories([]));
  }, []);

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    listExpenses({
      categoryId: categoryId || undefined,
      paymentMethod: paymentMethod || undefined,
      search: search || undefined,
      from: from || undefined,
      to: to || undefined,
      limit: 100,
    })
      .then((r) => {
        if (!mounted) return;
        setRows(r?.data || []);
        setMeta(r?.meta || null);
      })
      .catch(() => mounted && setRows([]))
      .finally(() => mounted && setLoading(false));
    return () => {
      mounted = false;
    };
  }, [refreshTick, categoryId, paymentMethod, search, from, to]);

  useEffect(() => {
    getExpenseSummary({ month, year })
      .then(setSummary)
      .catch(() => setSummary(null));
  }, [refreshTick, month, year]);

  async function onDelete(expense) {
    try {
      await deleteExpense(expense.id);
      toast.success('Expense deleted.');
      onMutated?.();
    } catch (err) {
      toast.error(err?.message || 'Failed to delete expense.');
    }
  }

  function exportCsv() {
    const header = [
      'Date', 'Category', 'Description', 'Amount AED', 'Method',
      'Bank', 'Paid by', 'Notes',
    ];
    const lines = [header.join(',')];
    for (const r of rows) {
      lines.push(
        [
          r.expenseDate,
          r.categoryName || '',
          r.description,
          Number(r.amount).toFixed(2),
          r.paymentMethod,
          r.bankName || '',
          r.paidByUsername || '',
          r.notes || '',
        ]
          .map(csvEscape)
          .join(','),
      );
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `expenses-${todayIso()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const columns = [
    { key: 'expenseDate', header: 'Date' },
    {
      key: 'category',
      header: 'Category',
      render: (r) => (
        <ExpenseCategoryIcon icon={r.categoryIcon} name={r.categoryName || '—'} />
      ),
    },
    {
      key: 'description',
      header: 'Description',
      render: (r) => (
        <div className="min-w-0">
          <div className="truncate">{r.description}</div>
          {r.notes && (
            <div className="truncate text-xs text-ink-muted" title={r.notes}>
              {r.notes}
            </div>
          )}
        </div>
      ),
    },
    {
      key: 'amount',
      header: 'Amount',
      align: 'right',
      render: (r) => <span className="font-medium">{aed(r.amount)}</span>,
    },
    {
      key: 'paymentMethod',
      header: 'Method',
      render: (r) => (
        <div className="text-sm">
          <div className="capitalize">{r.paymentMethod}</div>
          {r.bankName && (
            <div className="text-xs text-ink-muted">{r.bankName}</div>
          )}
        </div>
      ),
    },
    { key: 'paidByUsername', header: 'Paid by' },
    {
      key: 'receipt',
      header: 'Receipt',
      render: (r) =>
        r.receiptAttachment ? (
          <a
            href={fileUrl(r.receiptAttachment)}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-accent hover:underline"
          >
            <ExternalLink size={14} /> View
          </a>
        ) : (
          <span className="text-xs text-ink-muted">—</span>
        ),
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (r) => {
        // Same-day rule mirrors the server: compare the created_at calendar day.
        const created = r.createdAt
          ? new Date(r.createdAt).toISOString().slice(0, 10)
          : null;
        const canDelete =
          hasPermission('bills.pay') && created && created === todayIso();
        return canDelete ? (
          <button
            type="button"
            onClick={() => setConfirmDelete(r)}
            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-error hover:bg-error-light"
            title="Delete (same day only)"
          >
            <Trash2 size={16} />
          </button>
        ) : null;
      },
    },
  ];

  const totalAmount = meta?.totalAmount || 0;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <Tile
          label="This month"
          value={aed(summary?.monthTotal)}
          hint={`${summary?.byCategory?.reduce((n, c) => n + c.count, 0) || 0} expense(s)`}
        />
        <Tile
          label="This year"
          value={aed(summary?.yearTotal)}
        />
        <div className="rounded-card border border-border bg-surface p-4 shadow-soft">
          <div className="text-xs uppercase tracking-wider text-ink-muted">
            Top categories this month
          </div>
          <ul className="mt-2 space-y-1 text-sm">
            {(summary?.byCategory || [])
              .filter((c) => c.total > 0)
              .slice(0, 3)
              .map((c) => (
                <li
                  key={c.categoryId}
                  className="flex items-center justify-between"
                >
                  <ExpenseCategoryIcon
                    icon={c.categoryIcon}
                    name={c.categoryName}
                  />
                  <span className="font-medium">{aed(c.total)}</span>
                </li>
              ))}
            {(!summary?.byCategory || !summary.byCategory.some((c) => c.total > 0)) && (
              <li className="text-xs text-ink-muted">No expenses this month.</li>
            )}
          </ul>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 space-y-3">
          <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
            <select
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
              className="h-9 rounded-input border border-border bg-surface px-2 text-sm"
            >
              <option value="">All categories</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.icon || ''} {c.name}
                </option>
              ))}
            </select>
            <select
              value={paymentMethod}
              onChange={(e) => setPaymentMethod(e.target.value)}
              className="h-9 rounded-input border border-border bg-surface px-2 text-sm"
            >
              <option value="">All methods</option>
              <option value="cash">Cash</option>
              <option value="bank">Bank</option>
            </select>
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="h-9 rounded-input border border-border bg-surface px-2 text-sm"
            />
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="h-9 rounded-input border border-border bg-surface px-2 text-sm"
            />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search description"
              className="h-9 rounded-input border border-border bg-surface px-2 text-sm"
            />
          </div>
          <div className="flex items-center justify-between gap-2">
            <div className="text-sm text-ink-muted">
              {meta?.total ?? rows.length} expense(s) · {aed(totalAmount)}
            </div>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="secondary"
                leftIcon={<Download size={14} />}
                onClick={exportCsv}
              >
                Export CSV
              </Button>
              {hasPermission('bills.pay') && (
                <Button size="sm" leftIcon={<Plus size={14} />} onClick={onAdd}>
                  Add expense
                </Button>
              )}
            </div>
          </div>
          <Table
            columns={columns}
            rows={rows}
            rowKey={(r) => r.id}
            loading={loading}
            empty={
              <EmptyState
                title="No expenses recorded"
                description="Record cash or bank expenses to see them listed here."
              />
            }
          />
        </div>
        <div>
          <MonthlyExpenseSummary
            summary={summary}
            month={month}
            year={year}
            onChangeMonth={({ month: m, year: y }) => {
              setMonth(m);
              setYear(y);
            }}
          />
        </div>
      </div>

      <ConfirmDialog
        open={!!confirmDelete}
        title="Delete this expense?"
        description="This will reverse the treasury entry. Only same-day expenses can be deleted."
        confirmLabel="Delete"
        variant="danger"
        onClose={() => setConfirmDelete(null)}
        onConfirm={() => {
          const r = confirmDelete;
          setConfirmDelete(null);
          onDelete(r);
        }}
      />
    </div>
  );
}

function Tile({ label, value, hint }) {
  return (
    <div className="rounded-card border border-border bg-surface p-4 shadow-soft">
      <div className="text-xs uppercase tracking-wider text-ink-muted">{label}</div>
      <div className="mt-1 text-xl font-semibold">{value}</div>
      {hint && <div className="mt-0.5 text-xs text-ink-muted">{hint}</div>}
    </div>
  );
}
