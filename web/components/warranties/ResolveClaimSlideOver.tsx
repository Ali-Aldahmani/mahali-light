'use client';

import { useEffect, useState } from 'react';
import SlideOver from '@/components/ui/SlideOver';
import Button from '@/components/ui/Button';
import Select from '@/components/ui/Select';
import Textarea from '@/components/ui/Textarea';
import { searchProducts } from '@/services/productService';
import { resolveClaim } from '@/services/warrantyClaimService';
import { toast } from '@/store/toastStore';
import type { SelectOption, WarrantyClaim } from './types';

const RESOLUTION_OPTIONS: SelectOption[] = [
  { value: 'replaced', label: 'Replaced (issue zero-value invoice)' },
  { value: 'repaired', label: 'Repaired' },
  { value: 'rejected', label: 'Rejected' },
];

interface ResolveClaimSlideOverProps {
  claim: WarrantyClaim | null;
  open: boolean;
  onClose: (refresh?: boolean) => void;
}

export default function ResolveClaimSlideOver({ claim, open, onClose }: ResolveClaimSlideOverProps) {
  const [resolution, setResolution] = useState('replaced');
  const [notes, setNotes] = useState('');
  const [variantOpts, setVariantOpts] = useState<SelectOption[]>([]);
  const [variantId, setVariantId] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open || !claim) return;
    if (resolution !== 'replaced') {
      setVariantOpts([]);
      setVariantId('');
      return;
    }
    // Pull all variants for the warranty's product so the manager can pick
    // the actual replacement SKU (e.g. a different colour / spec).
    searchProducts('', 50)
      .then((products: any[]) => {
        const product = (products || []).find((p) => p.id === claim.productId);
        const variants = product?.variants || [];
        setVariantOpts(
          variants.map((v: any) => ({
            value: v.id,
            label: `${v.sku} (stock: ${v.stock_qty ?? 0})`,
            description: v.attributes_display || '',
          })),
        );
        if (variants[0]) setVariantId(variants[0].id);
      })
      .catch(() => {});
  }, [open, claim, resolution]);

  function reset() {
    setResolution('replaced');
    setNotes('');
    setVariantId('');
    setVariantOpts([]);
    setSubmitting(false);
  }

  async function submit() {
    if (!claim) return;
    if (resolution === 'rejected' && !notes.trim()) {
      toast.error('Please enter a rejection reason.');
      return;
    }
    if (resolution === 'replaced' && !variantId) {
      toast.error('Please select a replacement variant.');
      return;
    }
    setSubmitting(true);
    try {
      await resolveClaim(claim.id, {
        resolution,
        notes: notes.trim() || null,
        replacementVariantId: resolution === 'replaced' ? variantId : null,
      });
      toast.success('Claim resolved.');
      reset();
      onClose?.(true);
    } catch (e: any) {
      toast.error(e?.error?.message || e.message || 'Could not resolve claim.');
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
      title="Resolve claim"
      subtitle={claim?.claimNumber}
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
            {submitting ? 'Saving…' : 'Resolve claim'}
          </Button>
        </div>
      }
    >
      <div className="px-6 py-5 space-y-4">
        <Select
          label="Resolution"
          required
          value={resolution}
          onChange={(v: string) => setResolution(v)}
          options={RESOLUTION_OPTIONS}
        />

        {resolution === 'replaced' && (
          <Select
            label="Replacement variant"
            required
            value={variantId}
            onChange={(v: string) => setVariantId(v)}
            options={variantOpts}
            placeholder="Pick a replacement SKU"
            hint="A zero-value invoice will be created and stock will be deducted."
          />
        )}

        <Textarea
          label={resolution === 'rejected' ? 'Rejection reason' : 'Resolution notes'}
          required={resolution === 'rejected'}
          value={notes}
          onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setNotes(e.target.value)}
          rows={4}
          placeholder={
            resolution === 'repaired'
              ? 'What was repaired? Parts replaced?'
              : resolution === 'rejected'
                ? 'Why is the claim being rejected?'
                : 'Optional notes'
          }
        />
      </div>
    </SlideOver>
  );
}
