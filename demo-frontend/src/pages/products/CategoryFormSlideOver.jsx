import { useEffect, useState } from 'react';
import SlideOver from '../../components/ui/SlideOver.jsx';
import Input from '../../components/ui/Input.jsx';
import Button from '../../components/ui/Button.jsx';
import CategoryTreeSelect from '../../components/ui/CategoryTreeSelect.jsx';
import EmojiPicker from '../../components/ui/EmojiPicker.jsx';
import { createCategory, updateCategory } from '../../services/categoryService.js';
import { toast } from '../../store/toastStore.js';

const EMPTY = {
  name: '',
  parentId: null,
  description: '',
  requiresSerial: false,
  icon: null,
  isActive: true,
};

export default function CategoryFormSlideOver({
  open,
  onClose,
  initialValue = null,
  tree = [],
  onSaved,
}) {
  const isEdit = Boolean(initialValue?.id);
  const [form, setForm] = useState(EMPTY);
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setErrors({});
    if (initialValue) {
      setForm({
        name: initialValue.name || '',
        parentId: initialValue.parentId || null,
        description: initialValue.description || '',
        requiresSerial: !!initialValue.requiresSerial,
        icon: initialValue.icon || null,
        isActive: initialValue.isActive ?? true,
      });
    } else {
      setForm(EMPTY);
    }
  }, [open, initialValue]);

  function set(key, value) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function validate() {
    const errs = {};
    if (!form.name.trim()) errs.name = 'Category name is required.';
    setErrors(errs);
    return Object.keys(errs).length === 0;
  }

  async function onSubmit(e) {
    e.preventDefault();
    if (!validate()) return;

    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(),
        parentId: form.parentId || null,
        description: form.description.trim() || null,
        requiresSerial: form.requiresSerial,
        icon: form.icon || null,
        isActive: form.isActive,
      };
      if (isEdit) {
        await updateCategory(initialValue.id, payload);
        toast.success(`Category ${payload.name} updated.`);
      } else {
        await createCategory(payload);
        toast.success(`Category ${payload.name} created.`);
      }
      onSaved?.();
      onClose?.();
    } catch (err) {
      if (err?.code === 'VALIDATION_FAILED' && Array.isArray(err.details)) {
        const fe = {};
        for (const d of err.details) fe[d.path] = d.message;
        setErrors((p) => ({ ...p, ...fe }));
      } else {
        toast.error(err?.message || 'Could not save category.');
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <SlideOver
      open={open}
      onClose={onClose}
      title={isEdit ? 'Edit category' : 'Add category'}
      subtitle={
        isEdit
          ? `Update ${initialValue?.name}`
          : 'Categories group products and control attribute requirements.'
      }
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={onSubmit} loading={saving}>
            {isEdit ? 'Save changes' : 'Create category'}
          </Button>
        </>
      }
    >
      <form onSubmit={onSubmit} className="space-y-4">
        <Input
          label="Name"
          required
          value={form.name}
          onChange={(e) => set('name', e.target.value)}
          error={errors.name}
        />

        <CategoryTreeSelect
          label="Parent category"
          tree={tree}
          value={form.parentId}
          onChange={(id) => set('parentId', id)}
          allowNone
          noneLabel="— Top-level (no parent) —"
          hint={
            isEdit
              ? 'Cannot select this category or any of its descendants.'
              : 'Optional. Leave empty to create a top-level category.'
          }
        />

        <div>
          <label className="text-sm font-medium text-ink mb-1.5 block">Description</label>
          <textarea
            value={form.description}
            onChange={(e) => set('description', e.target.value)}
            rows={3}
            className="w-full rounded-input border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
          />
        </div>

        <EmojiPicker value={form.icon} onChange={(v) => set('icon', v)} />

        <div className="space-y-2 pt-2">
          <label className="inline-flex items-center gap-3 text-sm">
            <input
              type="checkbox"
              checked={form.requiresSerial}
              onChange={(e) => set('requiresSerial', e.target.checked)}
              className="h-4 w-4 rounded border-border text-accent focus:ring-accent"
            />
            <span>
              Requires serial numbers
              <span className="block text-xs text-ink-muted">
                Items will need a serial captured at sale time (Phase 4).
              </span>
            </span>
          </label>

          <label className="inline-flex items-center gap-3 text-sm">
            <input
              type="checkbox"
              checked={form.isActive}
              onChange={(e) => set('isActive', e.target.checked)}
              className="h-4 w-4 rounded border-border text-accent focus:ring-accent"
            />
            <span>Active</span>
          </label>
        </div>
      </form>
    </SlideOver>
  );
}
