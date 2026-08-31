import { useEffect, useState } from 'react';
import SlideOver from '../../components/ui/SlideOver.jsx';
import Input from '../../components/ui/Input.jsx';
import Button from '../../components/ui/Button.jsx';
import { createRole, updateRole } from '../../services/roleService.js';
import { toast } from '../../store/toastStore.js';

export default function RoleFormSlideOver({
  open,
  onClose,
  initialValue = null,
  onSaved,
}) {
  const isEdit = Boolean(initialValue?.id);
  const [form, setForm] = useState({ name: '', description: '' });
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setErrors({});
    if (initialValue) {
      setForm({
        name: initialValue.name || '',
        description: initialValue.description || '',
      });
    } else {
      setForm({ name: '', description: '' });
    }
  }, [open, initialValue]);

  function validate() {
    const errs = {};
    if (!form.name.trim()) errs.name = 'Role name is required.';
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
        description: form.description.trim() || null,
      };
      if (isEdit) {
        await updateRole(initialValue.id, payload);
        toast.success(`Role updated.`);
      } else {
        await createRole({ ...payload, permissionKeys: [] });
        toast.success(`Role created. Configure permissions next.`);
      }
      onSaved?.();
      onClose?.();
    } catch (err) {
      if (err?.code === 'ROLE_IS_SYSTEM') {
        toast.error('System roles cannot be renamed.');
      } else {
        toast.error(err?.message || 'Could not save role.');
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <SlideOver
      open={open}
      onClose={onClose}
      title={isEdit ? 'Edit role' : 'Add role'}
      subtitle={
        isEdit
          ? `Update ${initialValue?.name}`
          : 'New roles start with no permissions; configure them on the next step.'
      }
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={onSubmit} loading={saving}>
            {isEdit ? 'Save changes' : 'Create role'}
          </Button>
        </>
      }
    >
      <form onSubmit={onSubmit} className="space-y-4">
        <Input
          label="Role name"
          required
          value={form.name}
          onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          error={errors.name}
          disabled={isEdit && initialValue?.isSystem}
          hint={isEdit && initialValue?.isSystem ? 'System roles cannot be renamed.' : ''}
        />

        <div>
          <label className="text-sm font-medium text-ink mb-1.5 block">
            Description
          </label>
          <textarea
            value={form.description}
            onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
            rows={3}
            placeholder="What is this role for?"
            className="w-full rounded-input border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
          />
        </div>
      </form>
    </SlideOver>
  );
}
