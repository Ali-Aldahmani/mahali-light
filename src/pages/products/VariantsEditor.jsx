import { useState } from 'react';
import { Plus, Trash2, Wand2 } from 'lucide-react';
import Button from '../../components/ui/Button.jsx';
import Input from '../../components/ui/Input.jsx';
import Select from '../../components/ui/Select.jsx';
import { generateInternalBarcode } from '../../services/variantService.js';
import { toast } from '../../store/toastStore.js';

const EMPTY_VARIANT = () => ({
  attributeValueIds: {},
  sku: '',
  barcode: '',
  supplierBarcode: '',
  sellingPrice: 0,
  costPrice: 0,
  openingStock: 0,
  reorderThreshold: '',
});

// Inline editor used by the new product wizard.
// `attributes` is the ordered category attribute list.
// `variants` is the array of in-flight variant drafts kept by the parent.
export default function VariantsEditor({
  variants,
  setVariants,
  attributes,
  categoryId,
}) {
  const [bulkPrice, setBulkPrice] = useState('');

  function addRow() {
    setVariants((arr) => [...arr, EMPTY_VARIANT()]);
  }

  function removeRow(idx) {
    setVariants((arr) => arr.filter((_, i) => i !== idx));
  }

  function setField(idx, key, value) {
    setVariants((arr) => arr.map((v, i) => (i === idx ? { ...v, [key]: value } : v)));
  }

  function setAttr(idx, attributeId, valueId) {
    setVariants((arr) =>
      arr.map((v, i) =>
        i === idx
          ? {
              ...v,
              attributeValueIds: { ...(v.attributeValueIds || {}), [attributeId]: valueId },
            }
          : v,
      ),
    );
  }

  function applyBulkPrice() {
    if (bulkPrice === '' || isNaN(Number(bulkPrice))) return;
    setVariants((arr) =>
      arr.map((v) => ({ ...v, sellingPrice: Number(bulkPrice) })),
    );
    toast.success('Applied selling price to all variants.');
  }

  async function generateBarcode(idx) {
    try {
      const { barcode } = await generateInternalBarcode(categoryId);
      setField(idx, 'barcode', barcode);
    } catch (err) {
      toast.error(err?.message || 'Could not generate barcode.');
    }
  }

  if (variants.length === 0) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-ink-muted">
          Define variants using the attributes assigned to{' '}
          <strong>this product&apos;s category</strong>. Each variant gets its own SKU,
          barcode, price and stock.
        </p>
        <Button leftIcon={<Plus size={14} />} onClick={addRow}>
          Add first variant
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <p className="text-xs text-ink-muted">
          {variants.length} variant{variants.length === 1 ? '' : 's'}
        </p>
        <div className="flex items-center gap-2">
          <Input
            placeholder="Bulk selling price (AED)"
            type="number"
            step="0.01"
            min="0"
            value={bulkPrice}
            onChange={(e) => setBulkPrice(e.target.value)}
            containerClassName="w-56"
          />
          <Button
            size="sm"
            variant="secondary"
            leftIcon={<Wand2 size={13} />}
            onClick={applyBulkPrice}
            disabled={!bulkPrice}
          >
            Apply to all
          </Button>
        </div>
      </div>

      <div className="space-y-3">
        {variants.map((v, idx) => (
          <div key={idx} className="rounded-card border border-border bg-surface p-4">
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-sm font-semibold text-ink">Variant {idx + 1}</h4>
              <button
                type="button"
                onClick={() => removeRow(idx)}
                className="inline-flex items-center gap-1 text-xs text-error hover:underline"
              >
                <Trash2 size={12} /> Remove
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {attributes.map((a) => {
                const opts = (a.values || []).map((val) => ({
                  value: val.id,
                  label: val.value,
                }));
                return (
                  <Select
                    key={a.attributeId}
                    label={
                      <span>
                        {a.name}
                        {a.unit && (
                          <span className="text-ink-muted font-normal"> ({a.unit})</span>
                        )}
                        {a.isRequired && (
                          <span className="text-error ml-0.5">*</span>
                        )}
                      </span>
                    }
                    options={opts}
                    value={v.attributeValueIds?.[a.attributeId] || ''}
                    onChange={(val) => setAttr(idx, a.attributeId, val)}
                    placeholder="—"
                  />
                );
              })}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
              <Input
                label="SKU"
                placeholder="Leave blank to auto-generate"
                value={v.sku}
                onChange={(e) => setField(idx, 'sku', e.target.value)}
              />
              <div className="flex items-end gap-2">
                <Input
                  label="Internal barcode"
                  placeholder="Leave blank to auto-generate"
                  value={v.barcode}
                  onChange={(e) => setField(idx, 'barcode', e.target.value)}
                  containerClassName="flex-1"
                />
                <Button
                  type="button"
                  size="md"
                  variant="secondary"
                  onClick={() => generateBarcode(idx)}
                >
                  Generate
                </Button>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mt-3">
              <Input
                label="Selling price"
                type="number"
                step="0.01"
                min="0"
                value={v.sellingPrice}
                onChange={(e) => setField(idx, 'sellingPrice', e.target.value)}
              />
              <Input
                label="Cost price"
                type="number"
                step="0.01"
                min="0"
                value={v.costPrice}
                onChange={(e) => setField(idx, 'costPrice', e.target.value)}
              />
              <Input
                label="Opening stock"
                type="number"
                step="0.01"
                min="0"
                value={v.openingStock}
                onChange={(e) => setField(idx, 'openingStock', e.target.value)}
              />
              <Input
                label="Reorder threshold"
                type="number"
                step="0.01"
                min="0"
                value={v.reorderThreshold}
                onChange={(e) => setField(idx, 'reorderThreshold', e.target.value)}
              />
            </div>
          </div>
        ))}
      </div>

      <Button variant="secondary" leftIcon={<Plus size={14} />} onClick={addRow}>
        Add another variant
      </Button>
    </div>
  );
}
