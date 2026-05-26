import { useCallback, useEffect, useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  Pencil,
  Plus,
  Search,
  Sliders,
  Tag,
  X,
} from 'lucide-react';
import PageHeader from '../../components/ui/PageHeader.jsx';
import Button from '../../components/ui/Button.jsx';
import Input from '../../components/ui/Input.jsx';
import EmptyState from '../../components/ui/EmptyState.jsx';
import Spinner from '../../components/ui/Spinner.jsx';
import PermissionGate from '../../components/ui/PermissionGate.jsx';
import ConfirmDialog from '../../components/ui/ConfirmDialog.jsx';
import AttributeFormSlideOver from './AttributeFormSlideOver.jsx';
import {
  addAttributeValue,
  listAttributes,
  removeAttributeValue,
} from '../../services/attributeService.js';
import { toast } from '../../store/toastStore.js';
import { cn } from '../../utils/cn.js';

export default function AttributesPage() {
  const [items, setItems] = useState([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(new Set());

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);

  const [newValueDraft, setNewValueDraft] = useState({});
  const [confirmDel, setConfirmDel] = useState(null);
  const [delLoading, setDelLoading] = useState(false);

  const fetch = useCallback(async () => {
    setLoading(true);
    try {
      const data = await listAttributes();
      setItems(data || []);
    } catch (err) {
      toast.error(err?.message || 'Failed to load attributes');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetch();
  }, [fetch]);

  const filtered = items.filter((a) => {
    if (!search) return true;
    const term = search.toLowerCase();
    return (
      a.name.toLowerCase().includes(term) ||
      (a.values || []).some((v) => v.value.toLowerCase().includes(term))
    );
  });

  function toggle(id) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function addValue(attr) {
    const draft = (newValueDraft[attr.id] || '').trim();
    if (!draft) return;
    try {
      await addAttributeValue(attr.id, draft);
      setNewValueDraft((d) => ({ ...d, [attr.id]: '' }));
      fetch();
    } catch (err) {
      toast.error(err?.message || 'Could not add value.');
    }
  }

  async function deleteValue() {
    if (!confirmDel) return;
    setDelLoading(true);
    try {
      await removeAttributeValue(confirmDel.attributeId, confirmDel.id);
      toast.success('Value removed.');
      setConfirmDel(null);
      fetch();
    } catch (err) {
      if (err?.code === 'RESOURCE_IN_USE') {
        toast.error(err.message);
      } else {
        toast.error(err?.message || 'Could not delete value.');
      }
    } finally {
      setDelLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="card p-16 flex items-center justify-center">
        <Spinner size="lg" className="text-accent" />
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Attributes"
        subtitle="Define the technical attributes products and variants are described by."
        action={
          <PermissionGate permission="product.create">
            <Button
              leftIcon={<Plus size={16} />}
              onClick={() => {
                setEditing(null);
                setFormOpen(true);
              }}
            >
              Add Attribute
            </Button>
          </PermissionGate>
        }
      />

      {items.length === 0 ? (
        <EmptyState
          icon={<Sliders size={20} />}
          title="No attributes yet"
          description="Attributes are reusable characteristics like Wattage, Voltage or Color. They power product variants."
        />
      ) : (
        <>
          <div className="mb-4 flex items-center gap-2">
            <Input
              placeholder="Search attribute or value…"
              leftIcon={<Search size={14} />}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              containerClassName="max-w-sm flex-1"
            />
          </div>

          <div className="card overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-surface-2 text-ink-muted">
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide w-10"></th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide">
                    Name
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide w-24">
                    Unit
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide w-28">
                    Values
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide w-32">
                    Status
                  </th>
                  <th className="px-4 py-3 w-24"></th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-10 text-center text-ink-muted">
                      No attributes match your search.
                    </td>
                  </tr>
                )}
                {filtered.map((a) => {
                  const isOpen = expanded.has(a.id);
                  return (
                    <ExpandableRow
                      key={a.id}
                      attr={a}
                      isOpen={isOpen}
                      onToggle={() => toggle(a.id)}
                      onEdit={() => {
                        setEditing(a);
                        setFormOpen(true);
                      }}
                      newValueDraft={newValueDraft[a.id] || ''}
                      setNewValueDraft={(v) =>
                        setNewValueDraft((d) => ({ ...d, [a.id]: v }))
                      }
                      onAddValue={() => addValue(a)}
                      onDeleteValue={(v) =>
                        setConfirmDel({ ...v, attributeId: a.id, attrName: a.name })
                      }
                    />
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      <AttributeFormSlideOver
        open={formOpen}
        onClose={() => setFormOpen(false)}
        initialValue={editing}
        onSaved={fetch}
      />

      <ConfirmDialog
        open={!!confirmDel}
        onClose={() => setConfirmDel(null)}
        title={`Remove "${confirmDel?.value}"?`}
        description={`This will permanently delete the value from "${confirmDel?.attrName}".`}
        confirmLabel="Remove value"
        variant="danger"
        onConfirm={deleteValue}
        loading={delLoading}
      />
    </div>
  );
}

function ExpandableRow({
  attr,
  isOpen,
  onToggle,
  onEdit,
  newValueDraft,
  setNewValueDraft,
  onAddValue,
  onDeleteValue,
}) {
  return (
    <>
      <tr className="border-t border-border hover:bg-surface-2/40">
        <td className="px-4 py-3">
          <button
            type="button"
            onClick={onToggle}
            className="text-ink-muted hover:text-ink rounded-md p-0.5 hover:bg-surface-2"
          >
            {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </button>
        </td>
        <td className="px-4 py-3">
          <div className="flex items-center gap-2">
            <Tag size={14} className="text-ink-muted" />
            <span className="font-medium text-ink">{attr.name}</span>
          </div>
        </td>
        <td className="px-4 py-3 text-ink-muted">
          {attr.unit || <span className="text-ink-muted/60">—</span>}
        </td>
        <td className="px-4 py-3 text-right text-ink-muted">
          {(attr.values || []).length}
        </td>
        <td className="px-4 py-3 text-right">
          <span
            className={cn(
              'text-xs',
              attr.isActive ? 'text-success' : 'text-ink-muted',
            )}
          >
            {attr.isActive ? 'Active' : 'Inactive'}
          </span>
        </td>
        <td className="px-4 py-3 text-right">
          <PermissionGate permission="product.edit">
            <Button
              variant="ghost"
              size="sm"
              leftIcon={<Pencil size={13} />}
              onClick={onEdit}
            >
              Edit
            </Button>
          </PermissionGate>
        </td>
      </tr>
      {isOpen && (
        <tr className="border-t border-border bg-surface-2/30">
          <td></td>
          <td colSpan={5} className="px-4 py-4">
            <div className="flex flex-wrap gap-1.5">
              {(attr.values || []).length === 0 && (
                <span className="text-xs text-ink-muted">No values yet.</span>
              )}
              {(attr.values || []).map((v) => (
                <span
                  key={v.id}
                  className="inline-flex items-center gap-1 rounded-full bg-surface border border-border px-2.5 py-1 text-xs text-ink"
                >
                  {v.value}
                  <PermissionGate permission="product.edit">
                    <button
                      type="button"
                      onClick={() => onDeleteValue(v)}
                      className="text-ink-muted hover:text-error"
                      title="Remove"
                    >
                      <X size={12} />
                    </button>
                  </PermissionGate>
                </span>
              ))}
            </div>
            <PermissionGate permission="product.edit">
              <div className="mt-3 flex items-center gap-2 max-w-md">
                <input
                  value={newValueDraft}
                  onChange={(e) => setNewValueDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      onAddValue();
                    }
                  }}
                  placeholder="Add new value… (Enter)"
                  className="h-9 flex-1 rounded-input border border-border bg-surface px-3 text-sm outline-none focus:border-accent"
                />
                <Button size="sm" onClick={onAddValue} disabled={!newValueDraft.trim()}>
                  Add
                </Button>
              </div>
            </PermissionGate>
          </td>
        </tr>
      )}
    </>
  );
}
