'use client';

import { useEffect, useState } from 'react';
import Modal from '@/components/ui/Modal';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import CategoryTreeSelect from '@/components/ui/CategoryTreeSelect';
import { createProduct, searchProducts } from '@/services/productService';
import { listCategoriesTree } from '@/services/categoryService';
import { buildSimpleProductPayload } from '@/lib/products/quickCreate';
import { toast } from '@/store/toastStore';
import { useAuthStore } from '@/store/authStore';

export interface QuickAddProductModalProps {
  open: boolean;
  onClose: () => void;
  /** Refresh POS product grid after create */
  onRefreshProducts?: () => void;
  /** Add the new variant to the cart (POS search shape) */
  onAddToCart?: (variant: any) => void;
  /** Prefill the barcode (e.g. an unknown code that was just scanned) */
  initialBarcode?: string;
  categoryRequired?: boolean;
}

export default function QuickAddProductModal({
  open,
  onClose,
  onRefreshProducts,
  onAddToCart,
  initialBarcode = '',
  categoryRequired = true,
}: QuickAddProductModalProps) {
  const permissions = useAuthStore((s) => s.permissions);
  const canSeeCost = permissions.includes('product.view_cost');

  const [tree, setTree] = useState<any[]>([]);
  const [loadingTree, setLoadingTree] = useState(false);
  const [name, setName] = useState('');
  const [categoryId, setCategoryId] = useState<string | number | null>(null);
  const [sellingPrice, setSellingPrice] = useState('');
  const [openingStock, setOpeningStock] = useState('0');
  const [barcode, setBarcode] = useState('');
  const [costPrice, setCostPrice] = useState('');
  const [addToCart, setAddToCart] = useState(true);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  useEffect(() => {
    if (open && initialBarcode) setBarcode(initialBarcode);
  }, [open, initialBarcode]);

  useEffect(() => {
    if (!open) return;
    setLoadingTree(true);
    listCategoriesTree()
      .then((rows: any) => setTree(rows || []))
      .catch(() => setTree([]))
      .finally(() => setLoadingTree(false));
  }, [open]);

  function resetForm() {
    setName('');
    setCategoryId(null);
    setSellingPrice('');
    setOpeningStock('0');
    setBarcode('');
    setCostPrice('');
    setAddToCart(true);
    setErrors({});
  }

  function handleClose() {
    resetForm();
    onClose();
  }

  function validate() {
    const next: Record<string, string> = {};
    if (!name.trim()) next.name = 'Product name is required.';
    if (categoryRequired && !categoryId) next.categoryId = 'Choose a category.';
    const price = Number(sellingPrice);
    if (!Number.isFinite(price) || price < 0) next.sellingPrice = 'Enter a valid sell price.';
    const stock = Number(openingStock);
    if (!Number.isFinite(stock) || stock < 0) next.openingStock = 'Stock cannot be negative.';
    if (canSeeCost) {
      const cost = costPrice === '' ? 0 : Number(costPrice);
      if (!Number.isFinite(cost) || cost < 0) next.costPrice = 'Enter a valid cost (0 if unknown).';
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function submit() {
    if (!validate()) return;
    setSaving(true);
    try {
      const payload = buildSimpleProductPayload({
        name,
        categoryId,
        sellingPrice: Number(sellingPrice),
        costPrice: canSeeCost ? Number(costPrice || 0) : 0,
        openingStock: Number(openingStock || 0),
        barcode,
      });
      const created = await createProduct(payload);
      toast.success(`“${created.name}” added to your catalog.`);

      onRefreshProducts?.();

      if (addToCart && onAddToCart) {
        const code = barcode.trim();
        const matches = await searchProducts(code || created.name, 10);
        const variant = (matches || []).find((v: any) => v.productId === created.id);
        if (variant && Number(variant.stockQty || 0) > 0) {
          onAddToCart(variant);
          toast.success('Added to this order.');
        } else if (Number(openingStock || 0) <= 0) {
          toast.info('Product created with zero stock — set stock in Products to sell it.');
        }
      }

      resetForm();
      onClose();
    } catch (err: any) {
      toast.error(err?.message || 'Could not create product.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title="Quick add product"
      subtitle="Enter essentials now — open Products later for image, warranty, and full details."
      size="md"
      footer={
        <>
          <Button variant="secondary" onClick={handleClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={submit} loading={saving} disabled={loadingTree && categoryRequired}>
            {addToCart && onAddToCart ? 'Save & add to cart' : 'Create product'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Input
          label="Product name"
          required
          autoFocus
          value={name}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setName(e.target.value)}
          error={errors.name}
          placeholder="e.g. LED bulb 12W warm white"
        />
        <CategoryTreeSelect
          label={categoryRequired ? 'Category' : 'Category (optional)'}
          required={categoryRequired}
          tree={tree}
          value={categoryId}
          onChange={(id) => setCategoryId(id)}
          error={errors.categoryId}
          disabled={loadingTree}
          placeholder={loadingTree ? 'Loading categories…' : 'Select a category…'}
        />
        <div className="grid grid-cols-2 gap-4">
          <Input
            label="Sell price (AED)"
            required
            type="number"
            min={0}
            step="0.01"
            value={sellingPrice}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSellingPrice(e.target.value)}
            error={errors.sellingPrice}
            placeholder="0.00"
          />
          <Input
            label="Stock on hand"
            type="number"
            min={0}
            step="1"
            value={openingStock}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setOpeningStock(e.target.value)}
            error={errors.openingStock}
            placeholder="0"
          />
        </div>
        <Input
          label="Barcode (optional)"
          value={barcode}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setBarcode(e.target.value)}
          placeholder="Scan or type — SKU is auto-generated"
        />
        {canSeeCost && (
          <Input
            label="Cost price (AED)"
            type="number"
            min={0}
            step="0.01"
            value={costPrice}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setCostPrice(e.target.value)}
            error={errors.costPrice}
            placeholder="0.00 if unknown"
          />
        )}
        <label className="flex items-center gap-2 text-sm text-ink cursor-pointer select-none">
          <input
            type="checkbox"
            className="rounded border-border text-accent focus:ring-accent"
            checked={addToCart}
            onChange={(e) => setAddToCart(e.target.checked)}
          />
          Add to current order when in stock
        </label>
      </div>
    </Modal>
  );
}
