import { useEffect, useState } from 'react';
import { Pencil, Trash2 } from 'lucide-react';
import Table from '../../../components/ui/Table.jsx';
import Badge from '../../../components/ui/Badge.jsx';
import ExpenseCategoryIcon from '../../../components/ui/ExpenseCategoryIcon.jsx';
import ConfirmDialog from '../../../components/ui/ConfirmDialog.jsx';
import EmptyState from '../../../components/ui/EmptyState.jsx';
import CategoryFormSlideOver from '../../../components/bills/CategoryFormSlideOver.jsx';
import {
  listCategories,
  deleteCategory,
} from '../../../services/expenseCategoryService.js';
import { toast } from '../../../store/toastStore.js';

export default function CategoriesTab({ refreshTick, onMutated }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    listCategories()
      .then((r) => mounted && setRows(r || []))
      .catch(() => mounted && setRows([]))
      .finally(() => mounted && setLoading(false));
    return () => {
      mounted = false;
    };
  }, [refreshTick]);

  async function onDelete(cat) {
    try {
      await deleteCategory(cat.id);
      toast.success('Category deleted.');
      onMutated?.();
    } catch (err) {
      toast.error(err?.message || 'Failed to delete category.');
    }
  }

  const columns = [
    {
      key: 'name',
      header: 'Category',
      render: (r) => (
        <ExpenseCategoryIcon icon={r.icon} name={r.name} size="lg" />
      ),
    },
    {
      key: 'type',
      header: 'Type',
      render: (r) => (
        <Badge tone={r.type === 'recurring' ? 'accent' : 'neutral'}>
          {r.type === 'recurring' ? 'Recurring' : 'One-time'}
        </Badge>
      ),
    },
    {
      key: 'isActive',
      header: 'Status',
      render: (r) => (
        <Badge tone={r.isActive ? 'success' : 'muted'}>
          {r.isActive ? 'Active' : 'Hidden'}
        </Badge>
      ),
    },
    {
      key: 'bills',
      header: 'Bills',
      align: 'right',
      render: (r) => (
        <span className="text-sm">{r.billsCount}</span>
      ),
    },
    {
      key: 'expenses',
      header: 'Expenses',
      align: 'right',
      render: (r) => (
        <span className="text-sm">{r.expensesCount}</span>
      ),
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (r) => {
        const hasUsage = (r.billsCount || 0) + (r.expensesCount || 0) > 0;
        return (
          <div className="flex items-center justify-end gap-1">
            <button
              type="button"
              onClick={() => setEditing(r)}
              className="inline-flex h-8 w-8 items-center justify-center rounded-md text-ink-muted hover:bg-surface-2"
              title="Edit"
            >
              <Pencil size={16} />
            </button>
            <button
              type="button"
              disabled={hasUsage}
              onClick={() => setConfirmDelete(r)}
              className={`inline-flex h-8 w-8 items-center justify-center rounded-md ${
                hasUsage
                  ? 'text-ink-muted/50 cursor-not-allowed'
                  : 'text-error hover:bg-error-light'
              }`}
              title={hasUsage ? 'Cannot delete — in use' : 'Delete'}
            >
              <Trash2 size={16} />
            </button>
          </div>
        );
      },
    },
  ];

  return (
    <div className="space-y-4">
      <Table
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        loading={loading}
        empty={
          <EmptyState
            title="No categories"
            description="Add categories to bucket your bills and one-time expenses."
          />
        }
      />

      <CategoryFormSlideOver
        open={!!editing}
        category={editing}
        onClose={() => setEditing(null)}
        onSaved={onMutated}
      />
      <ConfirmDialog
        open={!!confirmDelete}
        title="Delete this category?"
        description="Categories linked to bills or expenses cannot be removed."
        confirmLabel="Delete"
        variant="danger"
        onClose={() => setConfirmDelete(null)}
        onConfirm={() => {
          const c = confirmDelete;
          setConfirmDelete(null);
          onDelete(c);
        }}
      />
    </div>
  );
}
