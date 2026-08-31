import { useEffect, useState } from 'react';
import SlideOver from '../../components/ui/SlideOver.jsx';
import Button from '../../components/ui/Button.jsx';
import Input from '../../components/ui/Input.jsx';
import Select from '../../components/ui/Select.jsx';
import Textarea from '../../components/ui/Textarea.jsx';
import { searchProducts } from '../../services/productService.js';
import { listCustomers } from '../../services/customerService.js';
import { createWarranty } from '../../services/warrantyService.js';
import { toast } from '../../store/toastStore.js';

const TYPE_OPTIONS = [
  { value: 'customer', label: 'Customer warranty' },
  { value: 'supplier', label: 'Supplier warranty' },
];

const DURATIONS = [
  { value: '6', label: '6 months' },
  { value: '12', label: '12 months' },
  { value: '24', label: '24 months' },
  { value: '36', label: '36 months' },
  { value: '60', label: '60 months' },
];

export default function WarrantyFormSlideOver({ open, onClose }) {
  const [productId, setProductId] = useState('');
  const [variantId, setVariantId] = useState('');
  const [customerId, setCustomerId] = useState('');
  const [serial, setSerial] = useState('');
  const [warrantyType, setWarrantyType] = useState('customer');
  const [startDate, setStartDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [duration, setDuration] = useState('12');
  const [terms, setTerms] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const [productOpts, setProductOpts] = useState([]);
  const [customerOpts, setCustomerOpts] = useState([]);
  const [variantOpts, setVariantOpts] = useState([]);

  useEffect(() => {
    if (!open) return;
    searchProducts('').then((data) => {
      setProductOpts(
        (data || []).map((p) => ({
          value: p.id,
          label: p.name,
          description: p.brand || '',
          variants: p.variants || [],
        })),
      );
    });
    listCustomers({ page: 1, limit: 50, is_active: 'true' })
      .then((res) => {
        setCustomerOpts(
          (res?.data || []).map((c) => ({
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
    } catch (e) {
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
          onChange={(v) => setProductId(v)}
          options={productOpts}
          placeholder="Select a product"
        />
        {variantOpts.length > 0 && (
          <Select
            label="Variant"
            value={variantId}
            onChange={(v) => setVariantId(v)}
            options={variantOpts}
          />
        )}
        <Select
          label="Customer (optional)"
          value={customerId}
          onChange={(v) => setCustomerId(v)}
          options={customerOpts}
          placeholder="Walk-in / not linked"
        />
        <Input
          label="Serial number (optional)"
          value={serial}
          onChange={(e) => setSerial(e.target.value)}
          placeholder="SN-…"
        />
        <Select
          label="Type"
          value={warrantyType}
          onChange={(v) => setWarrantyType(v)}
          options={TYPE_OPTIONS}
        />
        <div className="grid grid-cols-2 gap-3">
          <Input
            type="date"
            label="Start date"
            required
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
          />
          <Select
            label="Duration"
            value={duration}
            onChange={(v) => setDuration(v)}
            options={DURATIONS}
          />
        </div>
        <Textarea
          label="Coverage terms (optional)"
          value={terms}
          onChange={(e) => setTerms(e.target.value)}
          rows={3}
          placeholder="Manufacturer terms, exclusions, etc."
        />
      </div>
    </SlideOver>
  );
}
