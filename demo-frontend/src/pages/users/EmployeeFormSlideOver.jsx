import { useEffect, useState } from 'react';
import SlideOver from '../../components/ui/SlideOver.jsx';
import Input from '../../components/ui/Input.jsx';
import Button from '../../components/ui/Button.jsx';
import { createEmployee, updateEmployee } from '../../services/employeeService.js';
import { toast } from '../../store/toastStore.js';

const EMPTY = {
  name: '',
  phone: '',
  email: '',
  roleTitle: '',
  hireDate: '',
  shiftStart: '09:00',
  shiftEnd: '18:00',
  standardHours: 8,
  lateThresholdMins: 15,
  isActive: true,
};

export default function EmployeeFormSlideOver({
  open,
  onClose,
  initialValue = null,
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
        phone: initialValue.phone || '',
        email: initialValue.email || '',
        roleTitle: initialValue.roleTitle || '',
        hireDate: initialValue.hireDate ? initialValue.hireDate.slice(0, 10) : '',
        shiftStart: (initialValue.shiftStart || '09:00').slice(0, 5),
        shiftEnd: (initialValue.shiftEnd || '18:00').slice(0, 5),
        standardHours: Number(initialValue.standardHours || 8),
        lateThresholdMins: Number(initialValue.lateThresholdMins || 15),
        isActive: initialValue.isActive ?? true,
      });
    } else {
      setForm(EMPTY);
    }
  }, [open, initialValue]);

  function validate() {
    const errs = {};
    if (!form.name.trim()) errs.name = 'Name is required.';
    if (form.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) {
      errs.email = 'Enter a valid email address.';
    }
    if (form.standardHours < 0 || form.standardHours > 24) {
      errs.standardHours = 'Must be between 0 and 24.';
    }
    if (form.lateThresholdMins < 0 || form.lateThresholdMins > 180) {
      errs.lateThresholdMins = 'Must be between 0 and 180 minutes.';
    }
    setErrors(errs);
    return Object.keys(errs).length === 0;
  }

  function set(key, value) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function onSubmit(e) {
    e.preventDefault();
    if (!validate()) return;

    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(),
        phone: form.phone.trim() || null,
        email: form.email.trim() || null,
        roleTitle: form.roleTitle.trim() || null,
        hireDate: form.hireDate || null,
        shiftStart: form.shiftStart,
        shiftEnd: form.shiftEnd,
        standardHours: Number(form.standardHours),
        lateThresholdMins: Number(form.lateThresholdMins),
        isActive: form.isActive,
      };

      if (isEdit) {
        await updateEmployee(initialValue.id, payload);
        toast.success(`${payload.name} updated.`);
      } else {
        await createEmployee(payload);
        toast.success(`${payload.name} added.`);
      }
      onSaved?.();
      onClose?.();
    } catch (err) {
      if (err?.code === 'VALIDATION_FAILED' && Array.isArray(err.details)) {
        const fe = {};
        for (const d of err.details) fe[d.path] = d.message;
        setErrors((prev) => ({ ...prev, ...fe }));
      } else {
        toast.error(err?.message || 'Could not save employee.');
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <SlideOver
      open={open}
      onClose={onClose}
      width="lg"
      title={isEdit ? 'Edit employee' : 'Add employee'}
      subtitle={isEdit ? `Update details for ${initialValue?.name}` : 'Create a new employee record.'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={onSubmit} loading={saving}>
            {isEdit ? 'Save changes' : 'Add employee'}
          </Button>
        </>
      }
    >
      <form onSubmit={onSubmit} className="space-y-4">
        <Input
          label="Full name"
          required
          value={form.name}
          onChange={(e) => set('name', e.target.value)}
          error={errors.name}
        />

        <div className="grid grid-cols-2 gap-3">
          <Input
            label="Phone"
            value={form.phone}
            onChange={(e) => set('phone', e.target.value)}
            error={errors.phone}
          />
          <Input
            label="Email"
            type="email"
            value={form.email}
            onChange={(e) => set('email', e.target.value)}
            error={errors.email}
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Input
            label="Role title"
            placeholder="e.g. Senior Cashier"
            value={form.roleTitle}
            onChange={(e) => set('roleTitle', e.target.value)}
          />
          <Input
            label="Hire date"
            type="date"
            value={form.hireDate}
            onChange={(e) => set('hireDate', e.target.value)}
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Input
            label="Shift start"
            type="time"
            value={form.shiftStart}
            onChange={(e) => set('shiftStart', e.target.value)}
            error={errors.shiftStart}
          />
          <Input
            label="Shift end"
            type="time"
            value={form.shiftEnd}
            onChange={(e) => set('shiftEnd', e.target.value)}
            error={errors.shiftEnd}
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Input
            label="Standard hours / day"
            type="number"
            step="0.25"
            min="0"
            max="24"
            value={form.standardHours}
            onChange={(e) => set('standardHours', e.target.value)}
            error={errors.standardHours}
          />
          <Input
            label="Late threshold (minutes)"
            type="number"
            min="0"
            max="180"
            value={form.lateThresholdMins}
            onChange={(e) => set('lateThresholdMins', e.target.value)}
            error={errors.lateThresholdMins}
          />
        </div>

        <div className="flex items-center gap-3 pt-2">
          <input
            id="emp-active"
            type="checkbox"
            checked={form.isActive}
            onChange={(e) => set('isActive', e.target.checked)}
            className="h-4 w-4 rounded border-border text-accent focus:ring-accent"
          />
          <label htmlFor="emp-active" className="text-sm text-ink">
            Employee active
          </label>
        </div>
      </form>
    </SlideOver>
  );
}
