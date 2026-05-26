import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import SlideOver from '../../components/ui/SlideOver.jsx';
import Input from '../../components/ui/Input.jsx';
import Button from '../../components/ui/Button.jsx';
import { createAttribute, updateAttribute } from '../../services/attributeService.js';
import { toast } from '../../store/toastStore.js';

const EMPTY = { name: '', unit: '', values: [] };

export default function AttributeFormSlideOver({
  open,
  onClose,
  initialValue = null,
  onSaved,
}) {
  const isEdit = Boolean(initialValue?.id);
  const [form, setForm] = useState(EMPTY);
  const [draft, setDraft] = useState('');
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setErrors({});
    setDraft('');
    if (initialValue) {
      setForm({
        name: initialValue.name || '',
        unit: initialValue.unit || '',
        values: [], // managed inline on the page itself in edit mode
      });
    } else {
      setForm(EMPTY);
    }
  }, [open, initialValue]);

  function validate() {
    const errs = {};
    if (!form.name.trim()) errs.name = 'Name is required.';
    setErrors(errs);
    return Object.keys(errs).length === 0;
  }

  function addDraftValue() {
    const v = draft.trim();
    if (!v) return;
    if (form.values.includes(v)) {
      setDraft('');
      return;
    }
    setForm((f) => ({ ...f, values: [...f.values, v] }));
    setDraft('');
  }

  function removeValue(v) {
    setForm((f) => ({ ...f, values: f.values.filter((x) => x !== v) }));
  }

  function move(index, dir) {
    const target = index + dir;
    if (target < 0 || target >= form.values.length) return;
    const copy = [...form.values];
    const [item] = copy.splice(index, 1);
    copy.splice(target, 0, item);
    setForm((f) => ({ ...f, values: copy }));
  }

  async function onSubmit(e) {
    e.preventDefault();
    if (!validate()) return;

    setSaving(true);
    try {
      if (isEdit) {
        await updateAttribute(initialValue.id, {
          name: form.name.trim(),
          unit: form.unit.trim() || null,
        });
        toast.success(`Attribute updated.`);
      } else {
        await createAttribute({
          name: form.name.trim(),
          unit: form.unit.trim() || null,
          values: form.values.map((v, i) => ({ value: v, sortOrder: i + 1 })),
        });
        toast.success(`Attribute created.`);
      }
      onSaved?.();
      onClose?.();
    } catch (err) {
      if (err?.code === 'RESOURCE_CONFLICT') {
        setErrors({ name: 'An attribute with this name already exists.' });
      } else {
        toast.error(err?.message || 'Could not save attribute.');
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <SlideOver
      open={open}
      onClose={onClose}
      title={isEdit ? 'Edit attribute' : 'Add attribute'}
      subtitle={
        isEdit
          ? 'Update the attribute name or unit. Manage values from the table.'
          : 'Define a reusable attribute and optionally its initial values.'
      }
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={onSubmit} loading={saving}>
            {isEdit ? 'Save changes' : 'Create attribute'}
          </Button>
        </>
      }
    >
      <form onSubmit={onSubmit} className="space-y-4">
        <Input
          label="Name"
          required
          placeholder="e.g. Wattage"
          value={form.name}
          onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          error={errors.name}
        />

        <Input
          label="Unit"
          placeholder="e.g. W, V, mm² (optional)"
          value={form.unit}
          onChange={(e) => setForm((f) => ({ ...f, unit: e.target.value }))}
          hint="Displayed alongside values in dropdowns and the variant matrix."
        />

        {!isEdit && (
          <div>
            <label className="text-sm font-medium text-ink mb-1.5 block">
              Initial values
            </label>
            <div className="rounded-input border border-border bg-surface p-3">
              {form.values.length === 0 ? (
                <p className="text-xs text-ink-muted py-1">
                  Type a value and press Enter (or Add). You can also add values later
                  from the attributes table.
                </p>
              ) : (
                <ul className="space-y-1.5">
                  {form.values.map((v, i) => (
                    <li
                      key={v}
                      className="flex items-center gap-2 rounded-md bg-surface-2 px-2 py-1.5"
                    >
                      <div className="flex flex-col">
                        <button
                          type="button"
                          onClick={() => move(i, -1)}
                          disabled={i === 0}
                          className="text-ink-muted hover:text-ink disabled:opacity-30 text-[10px]"
                          title="Move up"
                        >
                          ▲
                        </button>
                        <button
                          type="button"
                          onClick={() => move(i, +1)}
                          disabled={i === form.values.length - 1}
                          className="text-ink-muted hover:text-ink disabled:opacity-30 text-[10px]"
                          title="Move down"
                        >
                          ▼
                        </button>
                      </div>
                      <span className="text-sm text-ink flex-1 truncate">{v}</span>
                      <button
                        type="button"
                        onClick={() => removeValue(v)}
                        className="text-ink-muted hover:text-error rounded-md p-1 hover:bg-error-light"
                      >
                        <X size={13} />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <div className="mt-3 flex items-center gap-2">
                <input
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      addDraftValue();
                    }
                  }}
                  placeholder="e.g. 9W"
                  className="h-9 flex-1 rounded-md border border-border bg-surface-2 px-2 text-sm outline-none focus:border-accent"
                />
                <Button
                  size="sm"
                  type="button"
                  variant="secondary"
                  onClick={addDraftValue}
                  disabled={!draft.trim()}
                >
                  Add
                </Button>
              </div>
            </div>
          </div>
        )}
      </form>
    </SlideOver>
  );
}
