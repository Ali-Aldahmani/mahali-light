import { useEffect, useState } from 'react';
import SlideOver from '../../components/ui/SlideOver.jsx';
import Input from '../../components/ui/Input.jsx';
import Select from '../../components/ui/Select.jsx';
import Button from '../../components/ui/Button.jsx';
import CategoryTreeSelect from '../../components/ui/CategoryTreeSelect.jsx';
import { updateProduct } from '../../services/productService.js';
import { toast } from '../../store/toastStore.js';

const SOLD_BY = [
  { value: 'piece', label: 'Piece' },
  { value: 'meter', label: 'Meter' },
  { value: 'roll', label: 'Roll' },
  { value: 'kg', label: 'Kilogram' },
  { value: 'box', label: 'Box' },
];

export default function ProductEditSlideOver({
  open,
  onClose,
  product,
  tree = [],
  onSaved,
}) {
  const [form, setForm] = useState({});
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open || !product) return;
    setErrors({});
    setForm({
      name: product.name || '',
      description: product.description || '',
      categoryId: product.categoryId || null,
      brand: product.brand || '',
      soldBy: product.soldBy || 'piece',
      unitLabel: product.unitLabel || 'pcs',
      defaultWarrantyMonths: product.defaultWarrantyMonths || 0,
      reorderThreshold: product.reorderThreshold || 0,
      isActive: product.isActive ?? true,
    });
  }, [open, product]);

  function set(key, value) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function validate() {
    const errs = {};
    if (!form.name?.trim()) errs.name = 'Name is required.';
    if (!form.categoryId) errs.categoryId = 'Select a category.';
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
        description: form.description?.trim() || null,
        categoryId: form.categoryId,
        brand: form.brand?.trim() || null,
        soldBy: form.soldBy,
        unitLabel: form.unitLabel?.trim() || 'pcs',
        defaultWarrantyMonths: Number(form.defaultWarrantyMonths) || 0,
        reorderThreshold: Number(form.reorderThreshold) || 0,
        isActive: form.isActive,
      };
      await updateProduct(product.id, payload);
      toast.success('Product updated.');
      onSaved?.();
      onClose?.();
    } catch (err) {
      toast.error(err?.message || 'Could not save product.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <SlideOver
      open={open}
      onClose={onClose}
      width="lg"
      title="Edit product"
      subtitle={product?.name}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={onSubmit} loading={saving}>
            Save changes
          </Button>
        </>
      }
    >
      <form onSubmit={onSubmit} className="space-y-4">
        <Input
          label="Product name"
          required
          value={form.name || ''}
          onChange={(e) => set('name', e.target.value)}
          error={errors.name}
        />

        <div>
          <label className="text-sm font-medium text-ink mb-1.5 block">Description</label>
          <textarea
            value={form.description || ''}
            onChange={(e) => set('description', e.target.value)}
            rows={3}
            className="w-full rounded-input border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <CategoryTreeSelect
            label="Category"
            required
            tree={tree}
            value={form.categoryId}
            onChange={(id) => set('categoryId', id)}
            error={errors.categoryId}
          />
          <Input
            label="Brand"
            value={form.brand || ''}
            onChange={(e) => set('brand', e.target.value)}
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Select
            label="Sold by"
            value={form.soldBy}
            onChange={(v) => set('soldBy', v)}
            options={SOLD_BY}
          />
          <Input
            label="Unit label"
            value={form.unitLabel || ''}
            onChange={(e) => set('unitLabel', e.target.value)}
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Input
            label="Default warranty (months)"
            type="number"
            min="0"
            max="120"
            value={form.defaultWarrantyMonths || 0}
            onChange={(e) => set('defaultWarrantyMonths', e.target.value)}
          />
          <Input
            label="Reorder threshold (total)"
            type="number"
            min="0"
            step="0.01"
            value={form.reorderThreshold || 0}
            onChange={(e) => set('reorderThreshold', e.target.value)}
          />
        </div>

        <label className="inline-flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={!!form.isActive}
            onChange={(e) => set('isActive', e.target.checked)}
            className="h-4 w-4 rounded border-border text-accent focus:ring-accent"
          />
          Active
        </label>
      </form>
    </SlideOver>
  );
}
