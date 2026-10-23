'use client';

import { useState } from 'react';
import Modal from '@/components/ui/Modal';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import { createSupplier } from '@/services/supplierService';
import { toast } from '@/store/toastStore';
import type { Supplier } from '@/components/suppliers/types';

export interface QuickAddSupplierModalProps {
  open: boolean;
  onClose: () => void;
  onCreated?: (supplier: Supplier) => void;
}

const EMPTY = {
  name: '',
  contactPerson: '',
  phone: '',
  email: '',
  paymentTerms: '',
};

export default function QuickAddSupplierModal({
  open,
  onClose,
  onCreated,
}: QuickAddSupplierModalProps) {
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  function reset() {
    setForm(EMPTY);
    setErrors({});
  }

  function handleClose() {
    if (saving) return;
    reset();
    onClose();
  }

  function setField(key: keyof typeof EMPTY, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
    if (errors[key]) setErrors((e) => ({ ...e, [key]: '' }));
  }

  function validate() {
    const next: Record<string, string> = {};
    const name = form.name.trim();
    if (!name) next.name = 'Supplier name is required.';
    else if (name.length > 200) next.name = 'Name cannot exceed 200 characters.';
    if (form.contactPerson.trim().length > 100) next.contactPerson = 'Contact name is too long.';
    if (form.phone.trim().length > 20) next.phone = 'Phone cannot exceed 20 characters.';
    const email = form.email.trim();
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      next.email = 'Enter a valid email address.';
    } else if (email.length > 100) {
      next.email = 'Email cannot exceed 100 characters.';
    }
    if (form.paymentTerms.trim().length > 100) next.paymentTerms = 'Payment terms are too long.';
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function submit() {
    if (!validate()) return;
    setSaving(true);
    try {
      const created = await createSupplier({
        name: form.name.trim(),
        contactPerson: form.contactPerson.trim() || null,
        phone: form.phone.trim() || null,
        email: form.email.trim() || null,
        address: null,
        paymentTerms: form.paymentTerms.trim() || null,
        defaultLeadTimeDays: 3,
        notes: null,
      });
      toast.success(`“${created.name}” added as a supplier.`);
      onCreated?.(created);
      reset();
      onClose();
    } catch (err: any) {
      if (err?.status === 403) {
        toast.error("You don't have permission to access this feature.");
      } else if (err?.details && typeof err.details === 'object') {
        setErrors(err.details);
        toast.error(err?.message || 'Could not create supplier. Your details are kept.');
      } else {
        toast.error(err?.message || 'Could not create supplier. Your details are kept.');
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title="Quick add supplier"
      subtitle="Add the essentials now — you can finish address and notes later from Suppliers."
      size="md"
      footer={
        <>
          <Button variant="secondary" onClick={handleClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={submit} loading={saving}>
            Create supplier
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Input
          label="Supplier name"
          required
          autoFocus
          value={form.name}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setField('name', e.target.value)}
          error={errors.name}
          placeholder="e.g. Falcon Electrical Trading LLC"
        />
        <div className="grid grid-cols-2 gap-4">
          <Input
            label="Contact person"
            value={form.contactPerson}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
              setField('contactPerson', e.target.value)
            }
            error={errors.contactPerson}
            placeholder="Sales rep name"
          />
          <Input
            label="Phone"
            value={form.phone}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setField('phone', e.target.value)}
            error={errors.phone}
            placeholder="+971…"
          />
        </div>
        <Input
          label="Email"
          type="email"
          value={form.email}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setField('email', e.target.value)}
          error={errors.email}
          placeholder="orders@example.com"
        />
        <Input
          label="Payment terms"
          value={form.paymentTerms}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
            setField('paymentTerms', e.target.value)
          }
          error={errors.paymentTerms}
          placeholder="Net 30 days"
        />
      </div>
    </Modal>
  );
}
