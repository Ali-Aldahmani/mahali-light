'use client';

import { useState } from 'react';
import Modal from '@/components/ui/Modal';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';

export interface CustomItemInput {
  description: string;
  thirdPartyName: string;
  unitPrice: number;
  costPrice: number;
  quantity: number;
}

export default function AddCustomItemModal({
  open,
  onClose,
  onAdd,
}: {
  open: boolean;
  onClose: () => void;
  onAdd: (item: CustomItemInput) => void;
}) {
  const [description, setDescription] = useState('');
  const [thirdPartyName, setThirdPartyName] = useState('');
  const [unitPrice, setUnitPrice] = useState('');
  const [costPrice, setCostPrice] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setDescription('');
    setThirdPartyName('');
    setUnitPrice('');
    setCostPrice('');
    setQuantity('1');
    setError(null);
  }

  function handleClose() {
    reset();
    onClose();
  }

  function handleAdd() {
    const desc = description.trim();
    const price = Number(unitPrice);
    const cost = Number(costPrice || 0);
    const qty = Number(quantity) || 1;
    if (!desc) {
      setError('Description is required.');
      return;
    }
    if (!Number.isFinite(price) || price < 0) {
      setError('Enter a valid selling price.');
      return;
    }
    if (!Number.isFinite(cost) || cost < 0) {
      setError('Enter a valid cost (0 if none).');
      return;
    }
    onAdd({ description: desc, thirdPartyName: thirdPartyName.trim(), unitPrice: price, costPrice: cost, quantity: qty });
    reset();
    onClose();
  }

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title="Add custom item"
      subtitle="For a product not in your catalog — e.g. a third-party item you resell but don't stock."
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={handleClose}>
            Cancel
          </Button>
          <Button onClick={handleAdd}>Add to cart</Button>
        </>
      }
    >
      <div className="space-y-3">
        {error && (
          <div className="rounded-input border border-error/30 bg-error-light px-3 py-2 text-sm text-error">
            {error}
          </div>
        )}
        <Input
          label="Description"
          required
          value={description}
          onChange={(e: any) => setDescription(e.target.value)}
          placeholder="e.g. Custom LED chandelier (client-supplied)"
          autoFocus
        />
        <Input
          label="Third-party / supplier name"
          value={thirdPartyName}
          onChange={(e: any) => setThirdPartyName(e.target.value)}
          placeholder="Who this is bought from (optional, for your own reference)"
          hint="Free text only — this isn't linked to a Supplier record."
        />
        <div className="grid grid-cols-2 gap-3">
          <Input
            label="Selling price (per unit)"
            type="number"
            required
            value={unitPrice}
            onChange={(e: any) => setUnitPrice(e.target.value)}
            placeholder="0.00"
          />
          <Input
            label="Cost owed to third party (per unit)"
            type="number"
            value={costPrice}
            onChange={(e: any) => setCostPrice(e.target.value)}
            placeholder="0.00"
            hint="Recorded as this sale's cost/margin — 0 if none."
          />
        </div>
        <Input
          label="Quantity"
          type="number"
          value={quantity}
          onChange={(e: any) => setQuantity(e.target.value)}
          placeholder="1"
        />
      </div>
    </Modal>
  );
}
