'use client';

import { useEffect, useState } from 'react';
import Modal from '@/components/ui/Modal';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import { updateProduct } from '@/services/productService';
import { updateVariant } from '@/services/variantService';
import { useAuthStore } from '@/store/authStore';
import { toast } from '@/store/toastStore';

export interface POSQuickEditModalProps {
  open: boolean;
  variant: any;
  onClose: () => void;
  onSuccess?: () => void;
}

export default function POSQuickEditModal({
  open,
  variant,
  onClose,
  onSuccess,
}: POSQuickEditModalProps) {
  const permissions = useAuthStore((s) => s.permissions);
  const canSeeCost = permissions.includes('product.view_cost');

  const [productName, setProductName] = useState('');
  const [sku, setSku] = useState('');
  const [barcode, setBarcode] = useState('');
  const [supplierBarcode, setSupplierBarcode] = useState('');
  const [sellingPrice, setSellingPrice] = useState('');
  const [costPrice, setCostPrice] = useState('');
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (open && variant) {
      setProductName(variant.productName || '');
      setSku(variant.sku || '');
      setBarcode(variant.internalBarcode || variant.barcode || '');
      setSupplierBarcode(variant.supplierBarcode || '');
      setSellingPrice(String(Number(variant.sellingPrice ?? 0)));
      setCostPrice(String(Number(variant.costPrice ?? 0)));
      setErrors({});
    }
  }, [open, variant]);

  if (!variant) return null;

  function validate() {
    const next: Record<string, string> = {};
    if (!productName.trim()) next.productName = 'Product name is required.';
    if (!sku.trim()) next.sku = 'SKU is required.';
    const sell = Number(sellingPrice);
    if (!Number.isFinite(sell) || sell < 0) next.sellingPrice = 'Enter a valid selling price.';
    if (canSeeCost) {
      const cost = Number(costPrice);
      if (!Number.isFinite(cost) || cost < 0) next.costPrice = 'Enter a valid cost price.';
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function handleSubmit() {
    if (!validate()) return;
    setSaving(true);
    try {
      const nextName = productName.trim();
      if (nextName !== variant.productName) {
        await updateProduct(variant.productId, { name: nextName });
      }

      // Send only what was changed. The till's product list can be minutes old,
      // and resending an untouched cost would undo a goods receipt that moved
      // the average cost in the meantime.
      const variantPayload: Record<string, any> = {};
      if (sku.trim() !== (variant.sku || '')) variantPayload.sku = sku.trim();
      if (barcode.trim() !== (variant.internalBarcode || variant.barcode || '')) {
        variantPayload.barcode = barcode.trim() || null;
      }
      if (supplierBarcode.trim() !== (variant.supplierBarcode || '')) {
        variantPayload.supplierBarcode = supplierBarcode.trim() || null;
      }
      if (Number(sellingPrice) !== Number(variant.sellingPrice ?? 0)) {
        variantPayload.sellingPrice = Number(sellingPrice);
      }
      if (canSeeCost && Number(costPrice || 0) !== Number(variant.costPrice ?? 0)) {
        variantPayload.costPrice = Number(costPrice || 0);
      }

      if (Object.keys(variantPayload).length > 0) {
        await updateVariant(variant.productId, variant.variantId, variantPayload);
      }

      toast.success(`Updated “${nextName}”.`);
      onSuccess?.();
      onClose();
    } catch (err: any) {
      toast.error(err?.message || 'Could not update item.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={() => !saving && onClose()}
      title="Quick edit"
      subtitle={`Update details for ${variant.productName}${variant.sku ? ` (${variant.sku})` : ''}`}
      size="md"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} loading={saving}>
            Save changes
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Input
          label="Product name"
          required
          autoFocus
          value={productName}
          onChange={(e: any) => setProductName(e.target.value)}
          error={errors.productName}
        />

        <div className="grid grid-cols-2 gap-4">
          <Input
            label="SKU"
            required
            value={sku}
            onChange={(e: any) => setSku(e.target.value)}
            error={errors.sku}
          />
          <Input
            label="Barcode"
            value={barcode}
            onChange={(e: any) => setBarcode(e.target.value)}
            placeholder="Internal / EAN barcode"
          />
        </div>

        <Input
          label="Supplier barcode (optional)"
          value={supplierBarcode}
          onChange={(e: any) => setSupplierBarcode(e.target.value)}
          placeholder="Manufacturer / supplier barcode"
        />

        <div className={`grid gap-4 ${canSeeCost ? 'grid-cols-2' : 'grid-cols-1'}`}>
          <Input
            label="Selling price (AED)"
            required
            type="number"
            min={0}
            step="0.01"
            value={sellingPrice}
            onChange={(e: any) => setSellingPrice(e.target.value)}
            error={errors.sellingPrice}
          />
          {canSeeCost && (
            <Input
              label="Cost price (AED)"
              type="number"
              min={0}
              step="0.01"
              value={costPrice}
              onChange={(e: any) => setCostPrice(e.target.value)}
              error={errors.costPrice}
            />
          )}
        </div>
      </div>
    </Modal>
  );
}

