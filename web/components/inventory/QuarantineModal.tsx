'use client';

import { useEffect, useState } from 'react';
import Modal from '@/components/ui/Modal';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import Select from '@/components/ui/Select';
import { resolveQuarantine } from '@/services/stockService';
import { toast } from '@/store/toastStore';

// Returned units held in quarantine go back on sale or are written off.
export default function QuarantineModal({
  variant, onClose, onDone,
}: { variant: any | null; onClose: () => void; onDone?: () => void }) {
  const [action, setAction] = useState<'release' | 'write_off'>('release');
  const [quantity, setQuantity] = useState('');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (variant) {
      setAction('release');
      setQuantity(String(variant.quarantineQty || ''));
      setReason('');
    }
  }, [variant]);

  if (!variant) return null;

  async function submit() {
    setSaving(true);
    try {
      await resolveQuarantine(variant.variantId || variant.id, {
        action, quantity: Number(quantity), reason: reason.trim(),
      });
      toast.success(action === 'release' ? 'Released back to stock.' : 'Written off.');
      onDone?.();
      onClose();
    } catch (err: any) {
      toast.error(err?.message || 'Could not update quarantine.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={!!variant}
      onClose={() => !saving && onClose()}
      title="Quarantined stock"
      subtitle={`${variant.productName || ''} · ${variant.quarantineQty} in quarantine`}
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={submit} loading={saving}>Save</Button>
        </>
      }
    >
      <div className="space-y-4">
        <Select
          label="What to do"
          value={action}
          onChange={(v: any) => setAction(v)}
          options={[
            { value: 'release', label: 'Release back to stock (it can be sold)' },
            { value: 'write_off', label: 'Write off (damaged, can’t be sold)' },
          ]}
        />
        <Input label="Quantity" type="number" min={0} step="1" value={quantity}
          onChange={(e: any) => setQuantity(e.target.value)} />
        <Input label="Reason" value={reason} onChange={(e: any) => setReason(e.target.value)}
          hint="At least 5 characters." />
      </div>
    </Modal>
  );
}
