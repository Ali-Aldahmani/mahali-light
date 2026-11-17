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
import InlineEdit from '@/components/ui/InlineEdit';
import Skeleton from '@/components/ui/skeleton';
import Badge from '@/components/ui/Badge';
import TriStateCheckbox from '@/components/ui/TriStateCheckbox';
import RequirePermission from '@/components/guards/RequirePermission';
import CategoryFormSlideOver from '@/components/products/CategoryFormSlideOver';
import CategoryAttributesPanel from '@/components/products/CategoryAttributesPanel';
import { deleteCategory, listCategoriesTree, updateCategory } from '@/services/categoryService';
import { listAttributes } from '@/services/attributeService';
import { toast } from '@/store/toastStore';
import { useProductStore } from '@/store/productStore';
import { cn } from '@/lib/utils/cn';
import { renameCategoryInTree, type CategoryId } from '@/lib/categories/tree';
import AuditLogButton from '@/components/audit/AuditLogButton';

function CategoriesPageContent() {
  const [tree, setTree] = useState<any[]>([]);
  const [attributes, setAttributes] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const [selectedId, setSelectedId] = useState<CategoryId | null>(null);
  const [expanded, setExpanded] = useState<Set<CategoryId>>(new Set());
  // Categories ticked with the checkboxes. Separate from `selectedId`, which
  // is the single category whose attributes show in the right-hand panel.
  const [checkedIds, setCheckedIds] = useState<Set<CategoryId>>(new Set());

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);

  const [confirmDel, setConfirmDel] = useState<any>(null);
  const [delLoading, setDelLoading] = useState(false);
  const [bulkDelOpen, setBulkDelOpen] = useState(false);
  const [bulkDelLoading, setBulkDelLoading] = useState(false);

  const refreshStore = useProductStore((s) => s.refreshAll);
  const refreshCategoryCache = useProductStore((s) => s.fetchCategories);

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
    const byId = new Map<CategoryId, any>();
    function walk(nodes: any[], parents: string[]) {
      for (const n of nodes) {
        const path = [...parents, n.name];
        const entry = { ...n, path: path.join(' > '), depth: parents.length };
        flat.push(entry);
        byId.set(n.id, entry);
        if (n.children?.length) walk(n.children, path);
      }
    }
    walk(tree, []);
    return { flat, byId };
  }, [tree]);

  const selected = selectedId ? byId.get(selectedId) : null;

  // Count only ticks that still exist, so a deleted category never lingers in
  // the selection.
  const totalCount = byId.size;
  const checkedCount = useMemo(() => {
    let count = 0;
    checkedIds.forEach((id) => {
      if (byId.has(id)) count += 1;
    });
    return count;
  }, [checkedIds, byId]);
  const allChecked = totalCount > 0 && checkedCount === totalCount;

  function toggleChecked(id: CategoryId) {
    setCheckedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // Select all covers every category in the hierarchy, including ones inside
  // collapsed parents.
  function toggleAllChecked() {
    setCheckedIds(allChecked ? new Set() : new Set(byId.keys()));
  }

  function toggleNode(id: CategoryId) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function expandAll() {
    const all = new Set<CategoryId>();
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

  async function renameCategory(category: any, nextName: string) {
    const saved = await updateCategory(category.id, { name: nextName });
    const confirmedName = saved?.name || nextName;
    setTree((current) => renameCategoryInTree(current, category.id, confirmedName));
    // Keep product/category selectors in other mounted surfaces coherent. This
    // does not refetch or replace the hierarchy currently being edited.
    void refreshCategoryCache(true);
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

  // Deletes every ticked category, deepest first so a ticked parent can go
  // once its ticked subcategories are gone. The server refuses categories that
  // still have products or subcategories; those stay ticked.
  async function confirmBulkDelete() {
    const targets = [...checkedIds]
      .map((id) => byId.get(id))
      .filter(Boolean)
      .sort((a, b) => b.depth - a.depth);
    if (!targets.length) {
      setBulkDelOpen(false);
      return;
    }
    setBulkDelLoading(true);
    const deleted = new Set<CategoryId>();
    let firstError: string | null = null;
    for (const c of targets) {
      try {
        await deleteCategory(c.id);
        deleted.add(c.id);
      } catch (err: any) {
        if (!firstError) firstError = err?.message || 'Could not delete category.';
      }
    }
    const failed = targets.length - deleted.size;
    if (deleted.size > 0) {
      toast.success(
        `${deleted.size} categor${deleted.size === 1 ? 'y' : 'ies'} removed.`,
      );
    }
    if (failed > 0) {
      toast.error(
        failed === 1 && firstError
          ? firstError
          : `${failed} categories could not be deleted because they still have products or subcategories.`,
      );
    }
    setCheckedIds((prev) => {
      const next = new Set(prev);
      deleted.forEach((id) => next.delete(id));
      return next;
    });
    if (selectedId && deleted.has(selectedId)) setSelectedId(null);
    setBulkDelLoading(false);
    setBulkDelOpen(false);
    if (deleted.size > 0) {
      await fetch();
      refreshStore();
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
          <span className="inline-flex items-center px-1">
            <TriStateCheckbox
              checked={checkedIds.has(n.id)}
              onChange={() => toggleChecked(n.id)}
              aria-label={`Select ${n.name}`}
            />
          </span>
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
            aria-label={hasChildren ? `${isOpen ? 'Collapse' : 'Expand'} ${n.name}` : undefined}
            aria-expanded={hasChildren ? isOpen : undefined}
            tabIndex={hasChildren ? 0 : -1}
          >
            {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </button>
          {n.icon ? (
            <span className="text-base leading-none">{n.icon}</span>
          ) : (
            <FolderTree size={14} className="text-ink-muted" />
          )}
          <div className={cn(
            'min-w-0 flex-1 text-sm',
            isSelected ? 'text-accent font-semibold' : 'text-ink',
          )}>
            <PermissionGate
              permission="product.edit"
              fallback={<span className="block truncate px-1">{n.name}</span>}
            >
              <InlineEdit
                value={n.name}
                onSave={(name) => renameCategory(n, name)}
                label={`Category name for ${n.name}`}
                validate={(name) => {
                  if (!name) return 'Category name is required.';
                  if (name.length > 100) return 'Category name must be 100 characters or fewer.';
                  return null;
                }}
                variant="body"
                as="span"
                className="max-w-full"
              />
            </PermissionGate>
          </div>
          {n.productCount > 0 && (
            <Badge tone="muted" size="sm">
              {n.productCount}
            </Badge>
          )}
          <div className="hidden group-hover:flex items-center gap-1 ml-1">
            <AuditLogButton entityType="category" entityId={n.id} recordLabel={n.name} compact />
            <PermissionGate permission="product.edit">
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
            </PermissionGate>
            <PermissionGate permission="product.delete">
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
            </PermissionGate>
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
        <div className="card p-5">
          <Skeleton lines={6} />
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
              <div className="flex items-center gap-2 min-w-0">
                <span className="inline-flex items-center pl-[5px] pr-1">
                  <TriStateCheckbox
                    checked={allChecked}
                    indeterminate={checkedCount > 0 && !allChecked}
                    onChange={toggleAllChecked}
                    aria-label="Select all categories"
                  />
                </span>
                {checkedCount > 0 ? (
                  <>
                    <span className="text-sm font-medium text-accent truncate">
                      {allChecked
                        ? `All ${totalCount} selected`
                        : `${checkedCount} of ${totalCount} selected`}
                    </span>
                    <button
                      type="button"
                      onClick={() => setCheckedIds(new Set())}
                      className="text-xs text-ink-muted hover:text-ink underline shrink-0"
                    >
                      Clear
                    </button>
                    <PermissionGate permission="product.delete">
                      <button
                        type="button"
                        onClick={() => setBulkDelOpen(true)}
                        className="inline-flex items-center gap-1 shrink-0 rounded-md px-2 py-0.5 text-xs font-medium text-error hover:bg-error-light"
                      >
                        <Trash2 size={12} />
                        Delete
                      </button>
                    </PermissionGate>
                  </>
                ) : (
                  <h3 className="text-sm font-semibold text-ink">Hierarchy</h3>
                )}
              </div>
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

      <ConfirmDialog
        open={bulkDelOpen}
        onClose={() => setBulkDelOpen(false)}
        title={`Delete ${checkedCount} categor${checkedCount === 1 ? 'y' : 'ies'}?`}
        description="This will remove the selected categories. Any that still have products, or subcategories you did not select, will be skipped."
        confirmLabel={`Delete ${checkedCount} categor${checkedCount === 1 ? 'y' : 'ies'}`}
        variant="danger"
        onConfirm={confirmBulkDelete}
        loading={bulkDelLoading}
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
