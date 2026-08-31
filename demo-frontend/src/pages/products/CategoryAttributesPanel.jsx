import { useEffect, useState } from 'react';
import { ChevronDown, GripVertical, Plus, Save, X } from 'lucide-react';
import Button from '../../components/ui/Button.jsx';
import Badge from '../../components/ui/Badge.jsx';
import Spinner from '../../components/ui/Spinner.jsx';
import {
  getCategoryAttributes,
  setCategoryAttributes,
} from '../../services/categoryService.js';
import { toast } from '../../store/toastStore.js';
import { cn } from '../../utils/cn.js';

// Right pane of the categories page.
// Shows the attributes attached to the selected category and lets the user
// add/remove them and toggle is_required. Reordering is via simple up/down
// buttons (HTML5 drag-and-drop would add too much complexity for Phase 2).
export default function CategoryAttributesPanel({ category, allAttributes }) {
  const [items, setItems] = useState([]);
  const [adding, setAdding] = useState(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (!category) {
      setItems([]);
      setDirty(false);
      return undefined;
    }
    let cancelled = false;
    setLoading(true);
    getCategoryAttributes(category.id)
      .then((data) => {
        if (cancelled) return;
        setItems(
          (data || []).map((a) => ({
            attributeId: a.attributeId,
            name: a.name,
            unit: a.unit,
            isRequired: a.isRequired,
            displayOrder: a.displayOrder,
          })),
        );
        setDirty(false);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [category]);

  function addAttribute(attr) {
    if (items.some((i) => i.attributeId === attr.id)) return;
    setItems((arr) => [
      ...arr,
      {
        attributeId: attr.id,
        name: attr.name,
        unit: attr.unit,
        isRequired: false,
        displayOrder: arr.length + 1,
      },
    ]);
    setDirty(true);
    setAdding(null);
  }

  function removeAttribute(attributeId) {
    setItems((arr) => arr.filter((i) => i.attributeId !== attributeId));
    setDirty(true);
  }

  function toggleRequired(attributeId) {
    setItems((arr) =>
      arr.map((i) =>
        i.attributeId === attributeId ? { ...i, isRequired: !i.isRequired } : i,
      ),
    );
    setDirty(true);
  }

  function move(index, dir) {
    setItems((arr) => {
      const target = index + dir;
      if (target < 0 || target >= arr.length) return arr;
      const copy = [...arr];
      const [item] = copy.splice(index, 1);
      copy.splice(target, 0, item);
      return copy.map((i, idx) => ({ ...i, displayOrder: idx + 1 }));
    });
    setDirty(true);
  }

  async function save() {
    if (!category) return;
    setSaving(true);
    try {
      await setCategoryAttributes(
        category.id,
        items.map((i, idx) => ({
          attributeId: i.attributeId,
          isRequired: i.isRequired,
          displayOrder: idx + 1,
        })),
      );
      toast.success(`Attributes saved for ${category.name}.`);
      setDirty(false);
    } catch (err) {
      toast.error(err?.message || 'Could not save attributes.');
    } finally {
      setSaving(false);
    }
  }

  if (!category) {
    return (
      <div className="card p-10 text-center text-ink-muted">
        Select a category on the left to view and manage its attributes.
      </div>
    );
  }

  const available = (allAttributes || []).filter(
    (a) => !items.some((i) => i.attributeId === a.id),
  );

  return (
    <div className="card overflow-hidden">
      <header className="flex items-start justify-between gap-3 px-5 py-4 border-b border-border">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            {category.icon && <span className="text-lg">{category.icon}</span>}
            <h3 className="text-base font-semibold text-ink truncate">{category.name}</h3>
          </div>
          <p className="mt-0.5 text-xs text-ink-muted">
            {category.path || '— top-level —'}
          </p>
          {category.description && (
            <p className="mt-2 text-sm text-ink-muted">{category.description}</p>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {category.requiresSerial && <Badge tone="warning">Requires serial</Badge>}
            {category.productCount !== undefined && (
              <span className="text-xs text-ink-muted">
                {category.productCount} active product
                {category.productCount === 1 ? '' : 's'}
              </span>
            )}
          </div>
        </div>
        <Button
          size="sm"
          leftIcon={<Save size={14} />}
          onClick={save}
          loading={saving}
          disabled={!dirty}
        >
          Save attributes
        </Button>
      </header>

      <div className="p-5">
        {loading ? (
          <div className="flex items-center justify-center py-10">
            <Spinner size="md" className="text-accent" />
          </div>
        ) : items.length === 0 ? (
          <div className="rounded-input border border-dashed border-border bg-surface-2 px-4 py-8 text-center text-sm text-ink-muted">
            No attributes assigned yet. Pick one from the list below.
          </div>
        ) : (
          <ul className="space-y-2">
            {items.map((i, idx) => (
              <li
                key={i.attributeId}
                className="flex items-center gap-3 rounded-input border border-border bg-surface px-3 py-2"
              >
                <div className="flex flex-col">
                  <button
                    type="button"
                    onClick={() => move(idx, -1)}
                    disabled={idx === 0}
                    className="text-ink-muted hover:text-ink disabled:opacity-30"
                    title="Move up"
                  >
                    <span className="text-xs">▲</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => move(idx, +1)}
                    disabled={idx === items.length - 1}
                    className="text-ink-muted hover:text-ink disabled:opacity-30"
                    title="Move down"
                  >
                    <span className="text-xs">▼</span>
                  </button>
                </div>
                <GripVertical size={14} className="text-ink-muted/60" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-ink truncate">
                    {i.name}
                    {i.unit && (
                      <span className="text-ink-muted font-normal ml-1">({i.unit})</span>
                    )}
                  </p>
                </div>
                <label className="inline-flex items-center gap-1.5 text-xs text-ink-muted">
                  <input
                    type="checkbox"
                    checked={i.isRequired}
                    onChange={() => toggleRequired(i.attributeId)}
                    className="h-3.5 w-3.5 rounded border-border text-accent focus:ring-accent"
                  />
                  Required
                </label>
                <button
                  type="button"
                  onClick={() => removeAttribute(i.attributeId)}
                  className="text-error/80 hover:text-error rounded-md p-1 hover:bg-error-light"
                  title="Remove"
                >
                  <X size={14} />
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="mt-4 relative">
          <Button
            variant="secondary"
            size="sm"
            leftIcon={<Plus size={14} />}
            rightIcon={<ChevronDown size={14} />}
            onClick={() => setAdding((v) => (v ? null : 'open'))}
            disabled={available.length === 0}
          >
            Add attribute
          </Button>

          {adding && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setAdding(null)} />
              <div className="absolute z-20 mt-1 w-72 card overflow-hidden">
                <div className="max-h-72 overflow-y-auto py-1">
                  {available.length === 0 ? (
                    <p className="px-3 py-3 text-sm text-ink-muted">
                      All attributes are already assigned.
                    </p>
                  ) : (
                    available.map((a) => (
                      <button
                        key={a.id}
                        type="button"
                        onClick={() => addAttribute(a)}
                        className={cn(
                          'w-full flex items-center justify-between px-3 py-2 text-left text-sm hover:bg-surface-2',
                        )}
                      >
                        <span className="truncate">
                          {a.name}
                          {a.unit && (
                            <span className="text-ink-muted ml-1">({a.unit})</span>
                          )}
                        </span>
                        <span className="text-xs text-ink-muted">
                          {(a.values || []).length} val
                        </span>
                      </button>
                    ))
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
