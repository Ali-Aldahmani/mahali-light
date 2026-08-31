import { useEffect, useState } from 'react';
import SlideOver from '../../components/ui/SlideOver.jsx';
import Input from '../../components/ui/Input.jsx';
import Button from '../../components/ui/Button.jsx';
import { toast } from '../../store/toastStore.js';
import {
  createSupplier,
  updateSupplier,
} from '../../services/supplierService.js';

const EMPTY = {
  name: '',
  contactPerson: '',
  phone: '',
  email: '',
  address: '',
  paymentTerms: '',
  defaultLeadTimeDays: 3,
  notes: '',
};

export default function SupplierFormSlideOver({ open, onClose, supplier, onSaved }) {
  const isEdit = !!supplier?.id;
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState({});

  useEffect(() => {
    if (open) {
      setErrors({});
      if (supplier) {
        setForm({
          name: supplier.name || '',
          contactPerson: supplier.contactPerson || '',
          phone: supplier.phone || '',
          email: supplier.email || '',
          address: supplier.address || '',
          paymentTerms: supplier.paymentTerms || '',
          defaultLeadTimeDays: supplier.defaultLeadTimeDays ?? 3,
          notes: supplier.notes || '',
        });
      } else {
        setForm(EMPTY);
      }
    }
  }, [open, supplier]);

  function setField(k, v) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  async function submit() {
    if (!form.name.trim()) {
      setErrors({ name: 'Name is required.' });
      return;
    }
    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(),
        contactPerson: form.contactPerson || null,
        phone: form.phone || null,
        email: form.email || null,
        address: form.address || null,
        paymentTerms: form.paymentTerms || null,
        defaultLeadTimeDays: Number(form.defaultLeadTimeDays || 0),
        notes: form.notes || null,
      };
      const saved = isEdit
        ? await updateSupplier(supplier.id, payload)
        : await createSupplier(payload);
      toast.success(isEdit ? 'Supplier updated.' : 'Supplier created.');
      onSaved?.(saved);
      onClose?.();
    } catch (err) {
      if (err?.details && typeof err.details === 'object') {
        setErrors(err.details);
      }
      toast.error(err?.message || 'Failed to save supplier.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <SlideOver
      open={open}
      onClose={onClose}
      title={isEdit ? 'Edit supplier' : 'New supplier'}
      subtitle={
        isEdit
          ? 'Update supplier contact details, payment terms, and lead time.'
          : 'Add a new supplier to track purchase orders and payments.'
      }
      width="md"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={submit} loading={saving}>
            {isEdit ? 'Save changes' : 'Create supplier'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Input
          label="Name"
          required
          value={form.name}
          onChange={(e) => setField('name', e.target.value)}
          error={errors.name}
          placeholder="e.g. Falcon Electrical Trading LLC"
        />
        <div className="grid grid-cols-2 gap-4">
          <Input
            label="Contact person"
            value={form.contactPerson}
            onChange={(e) => setField('contactPerson', e.target.value)}
            placeholder="Sales rep name"
          />
          <Input
            label="Phone"
            value={form.phone}
            onChange={(e) => setField('phone', e.target.value)}
            placeholder="+971…"
          />
        </div>
        <Input
          label="Email"
          type="email"
          value={form.email}
          onChange={(e) => setField('email', e.target.value)}
          placeholder="orders@example.com"
        />
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-ink">Address</label>
          <textarea
            value={form.address}
            onChange={(e) => setField('address', e.target.value)}
            rows={2}
            className="w-full rounded-input border border-border bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-muted focus:border-accent focus:ring-2 focus:ring-accent/20 focus:outline-none"
            placeholder="Street, building, area, emirate"
          />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <Input
            label="Payment terms"
            value={form.paymentTerms}
            onChange={(e) => setField('paymentTerms', e.target.value)}
            placeholder="Net 30 days"
          />
          <Input
            label="Default lead time (days)"
            type="number"
            min={0}
            value={form.defaultLeadTimeDays}
            onChange={(e) => setField('defaultLeadTimeDays', e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-ink">Notes</label>
          <textarea
            value={form.notes}
            onChange={(e) => setField('notes', e.target.value)}
            rows={3}
            className="w-full rounded-input border border-border bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-muted focus:border-accent focus:ring-2 focus:ring-accent/20 focus:outline-none"
            placeholder="Anything important to remember about this supplier."
          />
        </div>
      </div>
    </SlideOver>
  );
}
