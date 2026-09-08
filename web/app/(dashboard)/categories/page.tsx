'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  FolderTree,
  Pencil,
  Plus,
  Trash2,
} from 'lucide-react';
import PageHeader from '@/components/ui/PageHeader';
import Button from '@/components/ui/Button';
import EmptyState from '@/components/ui/EmptyState';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import PermissionGate from '@/components/ui/PermissionGate';
import Spinner from '@/components/ui/Spinner';
import Badge from '@/components/ui/Badge';
import RequirePermission from '@/components/guards/RequirePermission';
import CategoryFormSlideOver from '@/components/products/CategoryFormSlideOver';
import CategoryAttributesPanel from '@/components/products/CategoryAttributesPanel';
import { deleteCategory, listCategoriesTree } from '@/services/categoryService';
import { listAttributes } from '@/services/attributeService';
import { toast } from '@/store/toastStore';
import { useProductStore } from '@/store/productStore';
import { cn } from '@/lib/utils/cn';

function CategoriesPageContent() {
  const [tree, setTree] = useState<any[]>([]);
  const [attributes, setAttributes] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);

  const [confirmDel, setConfirmDel] = useState<any>(null);
  const [delLoading, setDelLoading] = useState(false);

  const refreshStore = useProductStore((s) => s.refreshAll);

  const fetch = useCallback(async () => {
    setLoading(true);
    try {
      const [t, a] = await Promise.all([listCategoriesTree(), listAttributes()]);
      setTree(t || []);
      setAttributes(a || []);
    } catch (err: any) {
      toast.error(err?.message || 'Failed to load categories');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetch();
  }, [fetch]);

  // Compute breadcrumb paths for selection display.
  const { byId } = useMemo(() => {
    const flat: any[] = [];
    const byId = new Map<number, any>();
    function walk(nodes: any[], parents: string[]) {
      for (const n of nodes) {
        const path = [...parents, n.name];
        const entry = { ...n, path: path.join(' > ') };
        flat.push(entry);
        byId.set(n.id, entry);
        if (n.children?.length) walk(n.children, path);
      }
    }
    walk(tree, []);
    return { flat, byId };
  }, [tree]);

  const selected = selectedId ? byId.get(selectedId) : null;

  function toggleNode(id: number) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function expandAll() {
    const all = new Set<number>();
    function walk(nodes: any[]) {
      for (const n of nodes) {
        if (n.children?.length) {
          all.add(n.id);
          walk(n.children);
        }
      }
    }
    walk(tree);
    setExpanded(all);
  }
  function collapseAll() {
    setExpanded(new Set());
  }

  async function confirmDelete() {
    if (!confirmDel) return;
    setDelLoading(true);
    try {
      await deleteCategory(confirmDel.id);
      toast.success(`Category ${confirmDel.name} removed.`);
      setConfirmDel(null);
      if (selectedId === confirmDel.id) setSelectedId(null);
      await fetch();
      refreshStore();
    } catch (err: any) {
      if (err?.code === 'RESOURCE_IN_USE') {
        toast.error(err.message);
      } else {
        toast.error(err?.message || 'Could not delete category.');
      }
    } finally {
      setDelLoading(false);
    }
  }

  function renderNode(n: any, depth: number) {
    const hasChildren = n.children && n.children.length > 0;
    const isOpen = expanded.has(n.id);
    const isSelected = selectedId === n.id;
    return (
      <div key={n.id}>
        <div
          className={cn(
            'group flex items-center gap-1 pr-2 py-1.5 rounded-md hover:bg-surface-2 cursor-pointer',
            isSelected && 'bg-accent-light',
          )}
          style={{ paddingLeft: 4 + depth * 16 }}
          onClick={() => setSelectedId(n.id)}
        >
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              if (hasChildren) toggleNode(n.id);
            }}
            className={cn(
              'h-5 w-5 inline-flex items-center justify-center text-ink-muted',
              !hasChildren && 'opacity-0 pointer-events-none',
            )}
            tabIndex={-1}
          >
            {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </button>
          {n.icon ? (
            <span className="text-base leading-none">{n.icon}</span>
          ) : (
            <FolderTree size={14} className="text-ink-muted" />
          )}
          <span
            className={cn(
              'flex-1 text-sm truncate',
              isSelected ? 'text-accent font-semibold' : 'text-ink',
            )}
          >
            {n.name}
          </span>
          {n.productCount > 0 && (
            <Badge tone="muted" size="sm">
              {n.productCount}
            </Badge>
          )}
          <div className="hidden group-hover:flex items-center gap-1 ml-1">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setEditing(n);
                setFormOpen(true);
              }}
              className="rounded-md p-1 hover:bg-surface text-ink-muted hover:text-ink"
              title="Edit category"
            >
              <Pencil size={12} />
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setConfirmDel(n);
              }}
              className="rounded-md p-1 hover:bg-error-light text-ink-muted hover:text-error"
              title="Delete category"
            >
              <Trash2 size={12} />
            </button>
          </div>
        </div>
        {hasChildren && isOpen && (
          <div>{n.children.map((c: any) => renderNode(c, depth + 1))}</div>
        )}
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Categories"
        subtitle="Organize products into a hierarchy and assign category-level attributes."
        action={
          <PermissionGate permission="product.create">
            <Button
              leftIcon={<Plus size={16} />}
              onClick={() => {
                setEditing(null);
                setFormOpen(true);
              }}
            >
              Add Category
            </Button>
          </PermissionGate>
        }
      />

      {loading ? (
        <div className="card p-16 flex items-center justify-center">
          <Spinner size="lg" className="text-accent" />
        </div>
      ) : tree.length === 0 ? (
        <EmptyState
          icon={<FolderTree size={20} />}
          title="No categories yet"
          description="Create the first category to start organizing your catalog."
          action={
            <PermissionGate permission="product.create">
              <Button
                leftIcon={<Plus size={16} />}
                onClick={() => {
                  setEditing(null);
                  setFormOpen(true);
                }}
              >
                Add Category
              </Button>
            </PermissionGate>
          }
        />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
          <div className="card lg:col-span-5 p-3">
            <div className="flex items-center justify-between px-2 pb-2 mb-1 border-b border-border">
              <h3 className="text-sm font-semibold text-ink">Hierarchy</h3>
              <div className="flex items-center gap-1 text-xs">
                <button
                  type="button"
                  onClick={expandAll}
                  className="text-ink-muted hover:text-ink px-2 py-0.5 rounded hover:bg-surface-2"
                >
                  Expand all
                </button>
                <button
                  type="button"
                  onClick={collapseAll}
                  className="text-ink-muted hover:text-ink px-2 py-0.5 rounded hover:bg-surface-2"
                >
                  Collapse all
                </button>
              </div>
            </div>
            <div className="max-h-[60vh] overflow-y-auto pr-1">
              {tree.map((n) => renderNode(n, 0))}
            </div>
          </div>

          <div className="lg:col-span-7">
            <CategoryAttributesPanel
              category={selected}
              allAttributes={attributes}
            />
          </div>
        </div>
      )}

      <CategoryFormSlideOver
        open={formOpen}
        onClose={() => setFormOpen(false)}
        initialValue={editing}
        tree={tree}
        onSaved={() => {
          fetch();
          refreshStore();
        }}
      />

      <ConfirmDialog
        open={!!confirmDel}
        onClose={() => setConfirmDel(null)}
        title={`Delete ${confirmDel?.name}?`}
        description={
          confirmDel?.productCount > 0
            ? `This category has ${confirmDel.productCount} active product(s) and cannot be deleted until they are moved or removed.`
            : 'This will remove the category. Categories with subcategories cannot be deleted.'
        }
        confirmLabel="Delete category"
        variant="danger"
        onConfirm={confirmDelete}
        loading={delLoading}
      />
    </div>
  );
}

export default function CategoriesPage() {
  return (
    <RequirePermission permission="product.view">
      <CategoriesPageContent />
    </RequirePermission>
  );
}
