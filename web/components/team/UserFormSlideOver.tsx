'use client';

import { useEffect, useMemo, useState } from 'react';
import SlideOver from '@/components/ui/SlideOver';
import Input from '@/components/ui/Input';
import Select from '@/components/ui/Select';
import Button from '@/components/ui/Button';
import { createUser, updateUser } from '@/services/userService';
import { listEmployees } from '@/services/employeeService';
import { toast } from '@/store/toastStore';

export default function UserFormSlideOver({
  open,
  onClose,
  initialValue = null,
  roles = [],
  onSaved,
}: any) {
  const isEdit = Boolean(initialValue?.id);
  const [form, setForm] = useState({
    username: '',
    password: '',
    roleId: '',
    employeeId: '',
    isActive: true,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [employeeOptions, setEmployeeOptions] = useState<any[]>([]);

  useEffect(() => {
    if (!open) return;
    setErrors({});
    if (initialValue) {
      setForm({
        username: initialValue.username || '',
        password: '',
        roleId: initialValue.role?.id || '',
        employeeId: initialValue.employee?.id || '',
        isActive: initialValue.isActive ?? true,
      });
    } else {
      setForm({
        username: '',
        password: '',
        roleId: roles[0]?.id || '',
        employeeId: '',
        isActive: true,
      });
    }
  }, [open, initialValue, roles]);

  useEffect(() => {
    if (!open) return;
    listEmployees({ limit: 100, isActive: 'true' })
      .then(({ data }: any) => {
        const opts = (data || []).map((e: any) => ({
          value: e.id,
          label: e.name,
          description: e.email || e.phone || e.roleTitle || '',
        }));
        setEmployeeOptions([{ value: '', label: '— None —' }, ...opts]);
      })
      .catch(() => setEmployeeOptions([{ value: '', label: '— None —' }]));
  }, [open]);

  const roleOptions = useMemo(
    () =>
      roles.map((r: any) => ({
        value: r.id,
        label: r.name,
        description: r.description || `${r.permissionKeys?.length || 0} permissions`,
      })),
    [roles],
  );

  function validate() {
    const errs: Record<string, string> = {};
    if (!form.username || form.username.length < 3) {
      errs.username = 'Username must be at least 3 characters.';
    } else if (!/^[a-zA-Z0-9_.-]+$/.test(form.username)) {
      errs.username = 'Only letters, numbers, dot, underscore, hyphen.';
    }
    if (!isEdit && (!form.password || form.password.length < 6)) {
      errs.password = 'Password must be at least 6 characters.';
    } else if (isEdit && form.password && form.password.length < 6) {
      errs.password = 'Password must be at least 6 characters.';
    }
    if (!form.roleId) errs.roleId = 'Select a role.';
    setErrors(errs);
    return Object.keys(errs).length === 0;
  }

  async function onSubmit(e: any) {
    e.preventDefault();
    if (!validate()) return;

    setSaving(true);
    try {
      const payload: any = {
        username: form.username.trim(),
        roleId: form.roleId,
        employeeId: form.employeeId || null,
        isActive: form.isActive,
      };
      if (form.password) payload.password = form.password;

      if (isEdit) {
        await updateUser(initialValue.id, payload);
        toast.success(`User ${payload.username} updated.`);
      } else {
        await createUser(payload);
        toast.success(`User ${payload.username} created.`);
      }
      onSaved?.();
      onClose?.();
    } catch (err: any) {
      if (err?.code === 'USERNAME_TAKEN') {
        setErrors((prev) => ({ ...prev, username: 'This username is already taken.' }));
      } else if (err?.code === 'VALIDATION_FAILED' && Array.isArray(err.details)) {
        const fe: Record<string, string> = {};
        for (const d of err.details) fe[d.path] = d.message;
        setErrors((prev) => ({ ...prev, ...fe }));
      } else {
        toast.error(err?.message || 'Could not save user.');
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <SlideOver
      open={open}
      onClose={onClose}
      title={isEdit ? 'Edit user' : 'Add user'}
      subtitle={isEdit ? `Update details for ${initialValue?.username}` : 'Create a new login account.'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={onSubmit} loading={saving}>
            {isEdit ? 'Save changes' : 'Create user'}
          </Button>
        </>
      }
    >
      <form onSubmit={onSubmit} className="space-y-4">
        <Select
          label="Linked employee"
          value={form.employeeId}
          onChange={(v: any) => setForm((f) => ({ ...f, employeeId: v }))}
          options={employeeOptions}
          placeholder="— None —"
          hint="Optional. Links the login to an employee record."
        />

        <Input
          label="Username"
          placeholder="e.g. cashier01"
          required
          value={form.username}
          onChange={(e: any) => setForm((f) => ({ ...f, username: e.target.value }))}
          error={errors.username}
        />

        <Input
          label={isEdit ? 'New password' : 'Password'}
          type="password"
          placeholder={isEdit ? 'Leave blank to keep current password' : 'Minimum 6 characters'}
          required={!isEdit}
          value={form.password}
          onChange={(e: any) => setForm((f) => ({ ...f, password: e.target.value }))}
          error={errors.password}
        />

        <Select
          label="Role"
          required
          value={form.roleId}
          onChange={(v: any) => setForm((f) => ({ ...f, roleId: v }))}
          options={roleOptions}
          placeholder="Select a role"
          error={errors.roleId}
        />

        <div className="flex items-center gap-3 pt-2">
          <input
            id="isActive"
            type="checkbox"
            checked={form.isActive}
            onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.checked }))}
            className="h-4 w-4 rounded border-border text-accent focus:ring-accent"
          />
          <label htmlFor="isActive" className="text-sm text-ink">
            Account active
          </label>
        </div>
      </form>
    </SlideOver>
  );
}
