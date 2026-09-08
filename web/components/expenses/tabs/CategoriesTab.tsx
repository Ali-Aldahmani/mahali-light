'use client';

import { useEffect, useState } from 'react';
import { Pencil, Trash2 } from 'lucide-react';
import Table, { type TableColumn } from '@/components/ui/Table';
import Badge from '@/components/ui/Badge';
import ExpenseCategoryIcon from '@/components/ui/ExpenseCategoryIcon';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import EmptyState from '@/components/ui/EmptyState';
import CategoryFormSlideOver from '@/components/bills/CategoryFormSlideOver';
import { listCategories, deleteCategory } from '@/services/expenseCategoryService';
import { toast } from '@/store/toastStore';

export default function CategoriesTab({
  refreshTick,
  onMutated,
}: {
  refreshTick: number;
  onMutated?: () => void;
}) {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [confirmDelete, setConfirmDelete] = useState<any>(null);

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    listCategories()
      .then((r: any) => mounted && setRows(r || []))
      .catch(() => mounted && setRows([]))
      .finally(() => mounted && setLoading(false));
    return () => {
      mounted = false;
    };
  }, [refreshTick]);

  async function onDelete(cat: any) {
    try {
      await deleteCategory(cat.id);
      toast.success('Category deleted.');
      onMutated?.();
    } catch (err: any) {
      toast.error(err?.message || 'Failed to delete category.');
    }
  }

  const columns: TableColumn[] = [
    {
      key: 'name',
      header: 'Category',
      render: (r: any) => (
        <ExpenseCategoryIcon icon={r.icon} name={r.name} size="lg" />
      ),
    },
    {
      key: 'type',
      header: 'Type',
      render: (r: any) => (
        <Badge tone={r.type === 'recurring' ? 'accent' : 'neutral'}>
          {r.type === 'recurring' ? 'Recurring' : 'One-time'}
        </Badge>
      ),
    },
    {
      key: 'isActive',
      header: 'Status',
      render: (r: any) => (
        <Badge tone={r.isActive ? 'success' : 'muted'}>
          {r.isActive ? 'Active' : 'Hidden'}
        </Badge>
      ),
    },
    {
      key: 'bills',
      header: 'Bills',
      align: 'right',
      render: (r: any) => (
        <span className="text-sm">{r.billsCount}</span>
      ),
    },
    {
      key: 'expenses',
      header: 'Expenses',
      align: 'right',
      render: (r: any) => (
        <span className="text-sm">{r.expensesCount}</span>
      ),
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (r: any) => {
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
        rowKey={(r: any) => r.id}
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
