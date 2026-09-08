'use client';

import { useEffect, useState } from 'react';
import SlideOver from '@/components/ui/SlideOver';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import Select from '@/components/ui/Select';
import Textarea from '@/components/ui/Textarea';
import { searchProducts } from '@/services/productService';
import { listCustomers } from '@/services/customerService';
import { createWarranty } from '@/services/warrantyService';
import { toast } from '@/store/toastStore';
import type { SelectOption } from './types';

const TYPE_OPTIONS: SelectOption[] = [
  { value: 'customer', label: 'Customer warranty' },
  { value: 'supplier', label: 'Supplier warranty' },
];

const DURATIONS: SelectOption[] = [
  { value: '6', label: '6 months' },
  { value: '12', label: '12 months' },
  { value: '24', label: '24 months' },
  { value: '36', label: '36 months' },
  { value: '60', label: '60 months' },
];

interface ProductVariantOption {
  id: string;
  sku: string;
  attributes_display?: string;
}

interface ProductOption extends SelectOption {
  variants: ProductVariantOption[];
}

interface WarrantyFormSlideOverProps {
  open: boolean;
  onClose: (refresh?: boolean) => void;
}

export default function WarrantyFormSlideOver({ open, onClose }: WarrantyFormSlideOverProps) {
  const [productId, setProductId] = useState('');
  const [variantId, setVariantId] = useState('');
  const [customerId, setCustomerId] = useState('');
  const [serial, setSerial] = useState('');
  const [warrantyType, setWarrantyType] = useState('customer');
  const [startDate, setStartDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [duration, setDuration] = useState('12');
  const [terms, setTerms] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const [productOpts, setProductOpts] = useState<ProductOption[]>([]);
  const [customerOpts, setCustomerOpts] = useState<SelectOption[]>([]);
  const [variantOpts, setVariantOpts] = useState<SelectOption[]>([]);

  useEffect(() => {
    if (!open) return;
    searchProducts('').then((data: any[]) => {
      setProductOpts(
        (data || []).map((p) => ({
          value: p.id,
          label: p.name,
          description: p.brand || '',
          variants: p.variants || [],
        })),
      );
    });
    listCustomers({ page: 1, limit: 50, isActive: 'true' })
      .then((res: any) => {
        setCustomerOpts(
          (res?.data || []).map((c: any) => ({
            value: c.id,
            label: c.name,
            description: c.phone || '',
          })),
        );
      })
      .catch(() => {});
  }, [open]);

  useEffect(() => {
    const product = productOpts.find((p) => p.value === productId);
    setVariantOpts(
      (product?.variants || []).map((v) => ({
        value: v.id,
        label: v.sku,
        description: v.attributes_display || '',
      })),
    );
    setVariantId('');
  }, [productId, productOpts]);

  function reset() {
    setProductId('');
    setVariantId('');
    setCustomerId('');
    setSerial('');
    setWarrantyType('customer');
    setStartDate(new Date().toISOString().slice(0, 10));
    setDuration('12');
    setTerms('');
    setSubmitting(false);
  }

  async function submit() {
    if (!productId) {
      toast.error('Please select a product.');
      return;
    }
    if (!startDate) {
      toast.error('Start date is required.');
      return;
    }
    setSubmitting(true);
    try {
      await createWarranty({
        productId,
        variantId: variantId || null,
        customerId: customerId || null,
        serialNumber: serial.trim() || null,
        warrantyType,
        startDate,
        durationMonths: Number(duration),
        terms: terms.trim() || null,
      });
      toast.success('Warranty created.');
      reset();
      onClose?.(true);
    } catch (e: any) {
      toast.error(e?.error?.message || e.message || 'Could not create warranty.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <SlideOver
      open={open}
      onClose={() => {
        reset();
        onClose?.(false);
      }}
      title="Add warranty"
      subtitle="Manually register a warranty record for a sale or supplier batch."
      footer={
        <div className="flex justify-end gap-2 px-6 py-4 border-t border-border">
          <Button
            variant="ghost"
            onClick={() => {
              reset();
              onClose?.(false);
            }}
          >
            Cancel
          </Button>
          <Button onClick={submit} disabled={submitting} variant="primary">
            {submitting ? 'Saving…' : 'Create warranty'}
          </Button>
        </div>
      }
    >
      <div className="px-6 py-5 space-y-4">
        <Select
          label="Product"
          required
          value={productId}
          onChange={(v: string) => setProductId(v)}
          options={productOpts}
          placeholder="Select a product"
        />
        {variantOpts.length > 0 && (
          <Select
            label="Variant"
            value={variantId}
            onChange={(v: string) => setVariantId(v)}
            options={variantOpts}
          />
        )}
        <Select
          label="Customer (optional)"
          value={customerId}
          onChange={(v: string) => setCustomerId(v)}
          options={customerOpts}
          placeholder="Walk-in / not linked"
        />
        <Input
          label="Serial number (optional)"
          value={serial}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSerial(e.target.value)}
          placeholder="SN-…"
        />
        <Select
          label="Type"
          value={warrantyType}
          onChange={(v: string) => setWarrantyType(v)}
          options={TYPE_OPTIONS}
        />
        <div className="grid grid-cols-2 gap-3">
          <Input
            type="date"
            label="Start date"
            required
            value={startDate}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setStartDate(e.target.value)}
          />
          <Select
            label="Duration"
            value={duration}
            onChange={(v: string) => setDuration(v)}
            options={DURATIONS}
          />
        </div>
        <Textarea
          label="Coverage terms (optional)"
          value={terms}
          onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setTerms(e.target.value)}
          rows={3}
          placeholder="Manufacturer terms, exclusions, etc."
        />
      </div>
    </SlideOver>
  );
}
