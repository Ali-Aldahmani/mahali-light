import { useEffect, useState } from 'react';
import SlideOver from '../../components/ui/SlideOver.jsx';
import Input from '../../components/ui/Input.jsx';
import Button from '../../components/ui/Button.jsx';
import Select from '../../components/ui/Select.jsx';
import ImageUpload from '../../components/ui/ImageUpload.jsx';
import {
  createVariant,
  generateInternalBarcode,
  updateVariant,
  uploadVariantImage,
} from '../../services/variantService.js';
import { toast } from '../../store/toastStore.js';

const EMPTY = {
  attributeValueIds: {},
  sku: '',
  barcode: '',
  supplierBarcode: '',
  sellingPrice: 0,
  costPrice: 0,
  openingStock: 0,
  reorderThreshold: '',
};

export default function VariantFormSlideOver({
  open,
  onClose,
  product,
  attributes = [],
  initialValue = null,
  onSaved,
  showCost = true,
}) {
  const isEdit = Boolean(initialValue?.id);
  const [form, setForm] = useState(EMPTY);
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [imageFile, setImageFile] = useState(null);

  useEffect(() => {
    if (!open) return;
    setErrors({});
    setImageFile(null);
    if (initialValue) {
      const attrMap = {};
      for (const link of initialValue.attributes || []) {
        attrMap[link.attributeId] = link.valueId;
      }
      setForm({
        attributeValueIds: attrMap,
        sku: initialValue.sku || '',
        barcode: initialValue.internalBarcode || initialValue.barcode || '',
        supplierBarcode: initialValue.supplierBarcode || '',
        sellingPrice: initialValue.sellingPrice ?? 0,
        costPrice: initialValue.costPrice ?? 0,
        openingStock: initialValue.stockQty ?? 0,
        reorderThreshold:
          initialValue.reorderThreshold === null ||
          initialValue.reorderThreshold === undefined
            ? ''
            : initialValue.reorderThreshold,
      });
    } else {
      setForm({ ...EMPTY, attributeValueIds: {} });
    }
  }, [open, initialValue]);

  function set(key, value) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function setAttr(attributeId, valueId) {
    setForm((f) => ({
      ...f,
      attributeValueIds: { ...f.attributeValueIds, [attributeId]: valueId || undefined },
    }));
  }

  function validate() {
    const errs = {};
    for (const a of attributes) {
      if (a.isRequired && !form.attributeValueIds[a.attributeId]) {
        errs[`attr-${a.attributeId}`] = `${a.name} is required.`;
      }
    }
    if (Number(form.sellingPrice) < 0) errs.sellingPrice = 'Cannot be negative.';
    if (Number(form.costPrice) < 0) errs.costPrice = 'Cannot be negative.';
    setErrors(errs);
    return Object.keys(errs).length === 0;
  }

  async function generate() {
    setGenerating(true);
    try {
      const { barcode } = await generateInternalBarcode(product?.categoryId);
      set('barcode', barcode);
    } catch (err) {
      toast.error(err?.message || 'Could not generate barcode.');
    } finally {
      setGenerating(false);
    }
  }

  async function onSubmit(e) {
    e?.preventDefault();
    if (!validate()) return;

    setSaving(true);
    try {
      const payload = {
        attributeValueIds: Object.values(form.attributeValueIds || {}).filter(Boolean),
        sku: form.sku || null,
        barcode: form.barcode || null,
        supplierBarcode: form.supplierBarcode || null,
        sellingPrice: Number(form.sellingPrice || 0),
        costPrice: Number(form.costPrice || 0),
        reorderThreshold:
          form.reorderThreshold === '' || form.reorderThreshold === null
            ? null
            : Number(form.reorderThreshold),
      };

      let savedVariant;
      if (isEdit) {
        // Stock is read-only here (adjusted in Phase 3).
        savedVariant = await updateVariant(product.id, initialValue.id, payload);
        toast.success('Variant updated.');
      } else {
        payload.openingStock = Number(form.openingStock || 0);
        savedVariant = await createVariant(product.id, payload);
        toast.success('Variant added.');
      }

      if (imageFile && savedVariant?.id) {
        try {
          await uploadVariantImage(product.id, savedVariant.id, imageFile);
        } catch (err) {
          toast.warning('Variant saved, but image upload failed.');
        }
      }

      onSaved?.();
      onClose?.();
    } catch (err) {
      if (err?.code === 'RESOURCE_CONFLICT') {
        toast.error(err.message);
        if (err.details?.field === 'sku') setErrors((e) => ({ ...e, sku: err.message }));
        if (err.details?.field === 'barcode')
          setErrors((e) => ({ ...e, barcode: err.message }));
      } else if (err?.code === 'VALIDATION_FAILED') {
        toast.error(err.message);
      } else {
        toast.error(err?.message || 'Could not save variant.');
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
      title={isEdit ? 'Edit variant' : 'Add variant'}
      subtitle={product?.name}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={onSubmit} loading={saving}>
            {isEdit ? 'Save changes' : 'Add variant'}
          </Button>
        </>
      }
    >
      <form onSubmit={onSubmit} className="space-y-4">
        {attributes.length > 0 && (
          <section className="space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
              Attributes
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {attributes.map((a) => (
                <Select
                  key={a.attributeId}
                  label={
                    <span>
                      {a.name}
                      {a.unit && (
                        <span className="text-ink-muted font-normal"> ({a.unit})</span>
                      )}
                    </span>
                  }
                  required={a.isRequired}
                  value={form.attributeValueIds[a.attributeId] || ''}
                  onChange={(v) => setAttr(a.attributeId, v)}
                  options={(a.values || []).map((v) => ({
                    value: v.id,
                    label: v.value,
                  }))}
                  error={errors[`attr-${a.attributeId}`]}
                  placeholder="—"
                />
              ))}
            </div>
          </section>
        )}

        <section className="space-y-3">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
            Identifiers
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Input
              label="SKU"
              placeholder={isEdit ? '' : 'Leave blank to auto-generate'}
              value={form.sku}
              onChange={(e) => set('sku', e.target.value)}
              error={errors.sku}
            />
            <div className="flex items-end gap-2">
              <Input
                label="Internal barcode"
                placeholder={isEdit ? '' : 'Leave blank to auto-generate'}
                value={form.barcode}
                onChange={(e) => set('barcode', e.target.value)}
                error={errors.barcode}
                containerClassName="flex-1"
              />
              {!isEdit && (
                <Button type="button" variant="secondary" onClick={generate} loading={generating}>
                  Generate
                </Button>
              )}
            </div>
          </div>
          <Input
            label="Supplier barcode (optional)"
            value={form.supplierBarcode}
            onChange={(e) => set('supplierBarcode', e.target.value)}
          />
        </section>

        <section className="space-y-3">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
            Pricing & stock
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Input
              label="Selling price (AED)"
              type="number"
              step="0.01"
              min="0"
              value={form.sellingPrice}
              onChange={(e) => set('sellingPrice', e.target.value)}
              error={errors.sellingPrice}
            />
            {showCost && (
              <Input
                label="Cost price (AED)"
                type="number"
                step="0.01"
                min="0"
                value={form.costPrice}
                onChange={(e) => set('costPrice', e.target.value)}
                error={errors.costPrice}
              />
            )}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {!isEdit && (
              <Input
                label="Opening stock"
                type="number"
                step="0.01"
                min="0"
                value={form.openingStock}
                onChange={(e) => set('openingStock', e.target.value)}
                hint="Stock adjustments after this happen in the Stock module."
              />
            )}
            <Input
              label="Reorder threshold (optional)"
              type="number"
              step="0.01"
              min="0"
              value={form.reorderThreshold}
              onChange={(e) => set('reorderThreshold', e.target.value)}
            />
          </div>
        </section>

        <ImageUpload
          label="Variant image (optional)"
          value={initialValue?.imagePath || null}
          onChange={setImageFile}
          hint="If empty, the product-level image is used."
        />
      </form>
    </SlideOver>
  );
}
