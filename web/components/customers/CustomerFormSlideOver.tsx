'use client';

import { useEffect, useRef, useState } from 'react';
import SlideOver from '@/components/ui/SlideOver';
import Input from '@/components/ui/Input';
import Button from '@/components/ui/Button';
import { toast } from '@/store/toastStore';
import {
  createCustomer,
  updateCustomer,
  searchCustomers,
} from '@/services/customerService';

export interface CustomerRecord {
  id: number | string;
  name: string;
  phone?: string | null;
  email?: string | null;
  companyName?: string | null;
  trnNumber?: string | null;
  address?: string | null;
  creditLimit?: number | null;
  notes?: string | null;
  isActive?: boolean;
}

interface CustomerFormSlideOverProps {
  open: boolean;
  onClose: () => void;
  customer: CustomerRecord | null;
  onSaved?: (saved: CustomerRecord) => void;
}

interface FormState {
  name: string;
  phone: string;
  email: string;
  companyName: string;
  trnNumber: string;
  address: string;
  creditLimit: number | string;
  notes: string;
  isActive: boolean;
}

const EMPTY: FormState = {
  name: '',
  phone: '',
  email: '',
  companyName: '',
  trnNumber: '',
  address: '',
  creditLimit: 0,
  notes: '',
  isActive: true,
};

function isValidTrn(trn: string) {
  if (!trn) return true;
  return /^\d{15}$/.test(trn.trim());
}

export default function CustomerFormSlideOver({
  open,
  onClose,
  customer,
  onSaved,
}: CustomerFormSlideOverProps) {
  const isEdit = !!customer?.id;
  const [form, setForm] = useState<FormState>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string | undefined>>({});
  const lastCheckedPhone = useRef('');

  useEffect(() => {
    if (open) {
      setErrors({});
      lastCheckedPhone.current = '';
      if (customer) {
        setForm({
          name: customer.name || '',
          phone: customer.phone || '',
          email: customer.email || '',
          companyName: customer.companyName || '',
          trnNumber: customer.trnNumber || '',
          address: customer.address || '',
          creditLimit: Number(customer.creditLimit || 0),
          notes: customer.notes || '',
          isActive: customer.isActive ?? true,
        });
      } else {
        setForm(EMPTY);
      }
    }
  }, [open, customer]);

  function setField<K extends keyof FormState>(k: K, v: FormState[K]) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  // Phone uniqueness check on blur. Calls /customers/search and checks for
  // any record with the exact phone. We ignore the customer being edited.
  async function checkPhoneUniqueness() {
    const phone = (form.phone || '').trim();
    if (!phone) {
      setErrors((e) => ({ ...e, phone: undefined }));
      return;
    }
    if (lastCheckedPhone.current === phone) return;
    lastCheckedPhone.current = phone;
    try {
      const matches = await searchCustomers(phone);
      const conflict = (matches || []).find(
        (m: CustomerRecord) => m.phone === phone && m.id !== customer?.id,
      );
      setErrors((e) => ({
        ...e,
        phone: conflict
          ? `Already used by ${conflict.name}.`
          : undefined,
      }));
    } catch (_e) {
      // Silent — server will still validate on submit.
    }
  }

  async function submit() {
    const localErrors: Record<string, string> = {};
    if (!form.name.trim()) localErrors.name = 'Name is required.';
    if (!form.phone.trim()) localErrors.phone = 'Phone is required.';
    if (!isValidTrn(form.trnNumber))
      localErrors.trnNumber = 'TRN must be exactly 15 digits.';
    if (Number(form.creditLimit) < 0)
      localErrors.creditLimit = 'Credit limit cannot be negative.';
    if (Object.keys(localErrors).length) {
      setErrors((e) => ({ ...e, ...localErrors }));
      return;
    }

    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        name: form.name.trim(),
        phone: form.phone.trim() || null,
        email: form.email.trim() || null,
        companyName: form.companyName.trim() || null,
        trnNumber: form.trnNumber.trim() || null,
        address: form.address || null,
        creditLimit: Number(form.creditLimit) || 0,
        notes: form.notes || null,
      };
      if (isEdit) payload.isActive = !!form.isActive;
      const saved = isEdit
        ? await updateCustomer(customer!.id, payload)
        : await createCustomer(payload);
      toast.success(isEdit ? 'Customer updated.' : 'Customer created.');
      onSaved?.(saved);
      onClose?.();
    } catch (err: any) {
      if (err?.code === 'VAL_DUPLICATE_PHONE') {
        setErrors((e) => ({ ...e, phone: err.message }));
      } else if (err?.code === 'VAL_INVALID_TRN') {
        setErrors((e) => ({ ...e, trnNumber: err.message }));
      }
      toast.error(err?.message || 'Failed to save customer.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <SlideOver
      open={open}
      onClose={onClose}
      title={isEdit ? 'Edit customer' : 'New customer'}
      subtitle={
        isEdit
          ? 'Update contact details, credit limit, and notes.'
          : 'Add a customer profile so you can track invoices and credit.'
      }
      width="md"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={submit} loading={saving}>
            {isEdit ? 'Save changes' : 'Create customer'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Input
          label="Name"
          required
          value={form.name}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setField('name', e.target.value)}
          error={errors.name}
          placeholder="Customer or contact person"
        />
        <div className="grid grid-cols-2 gap-4">
          <Input
            label="Phone"
            required
            value={form.phone}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setField('phone', e.target.value)}
            onBlur={checkPhoneUniqueness}
            error={errors.phone}
            placeholder="+971…"
          />
          <Input
            label="Email"
            type="email"
            value={form.email}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setField('email', e.target.value)}
            error={errors.email}
            placeholder="customer@example.com"
          />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <Input
            label="Company name"
            value={form.companyName}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setField('companyName', e.target.value)}
            placeholder="Optional · for B2B"
          />
          <Input
            label="TRN number"
            value={form.trnNumber}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setField('trnNumber', e.target.value)}
            error={errors.trnNumber}
            hint="UAE Tax Registration Number · 15 digits"
            placeholder="100123456700003"
          />
        </div>
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
        <Input
          label="Credit limit (AED)"
          type="number"
          min={0}
          step="0.01"
          value={form.creditLimit}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setField('creditLimit', e.target.value)}
          hint={
            Number(form.creditLimit) === 0
              ? 'No limit (set above 0 to cap credit sales).'
              : 'Sales on credit cannot push the balance above this amount.'
          }
          error={errors.creditLimit}
        />
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-ink">Notes</label>
          <textarea
            value={form.notes}
            onChange={(e) => setField('notes', e.target.value)}
            rows={3}
            className="w-full rounded-input border border-border bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-muted focus:border-accent focus:ring-2 focus:ring-accent/20 focus:outline-none"
            placeholder="Anything useful to remember about this customer."
          />
        </div>
        {isEdit && (
          <label className="inline-flex items-center gap-2 text-sm text-ink">
            <input
              type="checkbox"
              checked={form.isActive}
              onChange={(e) => setField('isActive', e.target.checked)}
              className="h-4 w-4 rounded border-border text-accent focus:ring-accent/30"
            />
            Active
          </label>
        )}
      </div>
    </SlideOver>
  );
}
