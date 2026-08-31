import { useEffect, useState } from 'react';
import SlideOver from '../ui/SlideOver.jsx';
import Button from '../ui/Button.jsx';
import Input from '../ui/Input.jsx';
import Select from '../ui/Select.jsx';
import {
  createCategory,
  updateCategory,
} from '../../services/expenseCategoryService.js';
import { toast } from '../../store/toastStore.js';

const TYPE_OPTIONS = [
  { value: 'recurring', label: 'Recurring (bills)' },
  { value: 'one_time', label: 'One-time (expenses)' },
];

const COMMON_ICONS = [
  '⚡','💧','🌐','🏠','📋','🏛️','🛡️','🔧','📦','📢','🚗','📌',
  '💼','✈️','🍽️','🧾','💡','🛒','📞','🪙','🧰','🎓',
];

export default function CategoryFormSlideOver({ open, onClose, category = null, onSaved }) {
  const isEdit = !!category?.id;
  const [name, setName] = useState('');
  const [type, setType] = useState('recurring');
  const [icon, setIcon] = useState('');
  const [isActive, setIsActive] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!open) return;
    setName(category?.name || '');
    setType(category?.type || 'recurring');
    setIcon(category?.icon || '');
    setIsActive(category?.isActive !== false);
    setError(null);
  }, [open, category]);

  async function submit() {
    setError(null);
    if (!name.trim()) {
      setError('Name is required.');
      return;
    }
    setBusy(true);
    try {
      const body = {
        name: name.trim(),
        type,
        icon: icon || null,
        isActive,
      };
      const saved = isEdit
        ? await updateCategory(category.id, body)
        : await createCategory(body);
      toast.success(isEdit ? 'Category updated.' : 'Category added.');
      onSaved?.(saved);
      onClose();
    } catch (err) {
      setError(err?.message || 'Failed to save category.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <SlideOver
      open={open}
      onClose={onClose}
      title={isEdit ? 'Edit category' : 'Add category'}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={submit} loading={busy}>
            {isEdit ? 'Save changes' : 'Add category'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Input
          label="Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />
        <Select
          label="Type"
          value={type}
          onChange={setType}
          options={TYPE_OPTIONS}
          searchable={false}
          required
        />
        <div>
          <label className="mb-1.5 block text-sm font-medium">Icon</label>
          <div className="flex flex-wrap gap-2 rounded-input border border-border bg-surface p-2">
            {COMMON_ICONS.map((e) => (
              <button
                key={e}
                type="button"
                onClick={() => setIcon(e)}
                className={`h-9 w-9 rounded-md text-lg leading-none transition ${
                  icon === e
                    ? 'bg-accent-light ring-2 ring-accent'
                    : 'bg-surface-2 hover:bg-surface'
                }`}
              >
                {e}
              </button>
            ))}
          </div>
          {icon && (
            <div className="mt-1.5 text-xs text-ink-muted">
              Selected: <span className="text-base">{icon}</span>
            </div>
          )}
        </div>

        {isEdit && (
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={isActive}
              onChange={(e) => setIsActive(e.target.checked)}
              className="h-4 w-4 rounded border-border text-accent focus:ring-accent"
            />
            Active
          </label>
        )}

        {error && (
          <div className="rounded-input bg-error-light p-2 text-xs text-error">
            {error}
          </div>
        )}
      </div>
    </SlideOver>
  );
}
