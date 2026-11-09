'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from '@/store/toastStore';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import Select from '@/components/ui/Select';
import { BankAccountSelect } from '@/components/payments/BankTenderFields';
import {
  createPaymentProvider,
  listPaymentProviders,
  updatePaymentProvider,
  type PaymentProvider,
} from '@/services/paymentProviderService';

const METHODS = [
  { value: 'percent', label: 'Percentage (%)' },
  { value: 'fixed', label: 'Fixed amount' },
  { value: 'percent_fixed', label: 'Percentage + fixed amount' },
];
const REFUND_CHARGE = [{ value: 'none', label: 'No refund charge' }, ...METHODS];
const REFUND_POLICY = [
  { value: 'none', label: 'Fee is not given back (default)' },
  { value: 'proportional', label: 'Provider gives back the fee in proportion' },
];

type Draft = Required<Pick<PaymentProvider,
  'name' | 'feeMethod' | 'feePercent' | 'feeFixed' | 'refundFeePolicy' | 'refundChargeMethod'
  | 'refundChargePercent' | 'refundChargeFixed' | 'isDefault' | 'isActive'>> & { bankAccountId: string | null };

const EMPTY: Draft = {
  name: '', bankAccountId: null, feeMethod: 'percent', feePercent: 0, feeFixed: 0,
  refundFeePolicy: 'none', refundChargeMethod: 'none', refundChargePercent: 0, refundChargeFixed: 0,
  isDefault: false, isActive: true,
};

const usesPercent = (m: string) => m === 'percent' || m === 'percent_fixed';
const usesFixed = (m: string) => m === 'fixed' || m === 'percent_fixed';

function describe(p: PaymentProvider) {
  const parts: string[] = [];
  if (usesPercent(p.feeMethod || '')) parts.push(`${p.feePercent}%`);
  if (usesFixed(p.feeMethod || '')) parts.push(`AED ${Number(p.feeFixed || 0).toFixed(2)}`);
  return parts.join(' + ') || 'no fee';
}

function newKey() {
  return typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
}

// Card providers and their processing fees. Fees apply to the card-paid part
// of a sale and are recorded with the rates of the day; editing a provider
// only affects sales confirmed afterwards.
export default function CardFeesSettings({ canManage }: { canManage: boolean }) {
  const [providers, setProviders] = useState<PaymentProvider[]>([]);
  const [editing, setEditing] = useState<string | 'new' | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [requestKey, setRequestKey] = useState(newKey);

  const load = useCallback(() => {
    listPaymentProviders({ all: true }).then((r: any) => setProviders(r || [])).catch(() => {});
  }, []);
  useEffect(() => { load(); }, [load]);

  const patch = (p: Partial<Draft>) => setDraft((d) => ({ ...d, ...p }));

  function start(p?: PaymentProvider) {
    setEditing(p ? p.id : 'new');
    setRequestKey(newKey());
    setDraft(p ? {
      name: p.name, bankAccountId: p.bankAccountId || null, feeMethod: p.feeMethod || 'percent',
      feePercent: p.feePercent || 0, feeFixed: p.feeFixed || 0, refundFeePolicy: p.refundFeePolicy || 'none',
      refundChargeMethod: p.refundChargeMethod || 'none', refundChargePercent: p.refundChargePercent || 0,
      refundChargeFixed: p.refundChargeFixed || 0, isDefault: !!p.isDefault, isActive: p.isActive !== false,
    } : EMPTY);
  }

  async function submit() {
    if (!draft.name.trim()) {
      toast.error('Give the provider a name.');
      return;
    }
    setSaving(true);
    try {
      if (editing === 'new') await createPaymentProvider(draft, requestKey);
      else if (editing) await updatePaymentProvider(editing, draft);
      toast.success('Card provider saved.');
      setEditing(null);
      load();
    } catch (err: any) {
      toast.error(err?.message || 'Could not save the provider.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-ink-muted">
        Fees are taken from the card-paid part of each sale and reduce contribution profit, not gross profit.
        Customers are always refunded in full.
      </p>

      <div className="divide-y divide-border rounded-card border border-border">
        {providers.length === 0 && (
          <p className="px-4 py-6 text-center text-sm text-ink-muted">
            No card providers yet. Until one is added, card sales carry no fee.
          </p>
        )}
        {providers.map((p) => (
          <div key={p.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
            <div className="min-w-0">
              <div className="font-medium text-ink">
                {p.name}
                {p.isDefault && <span className="ml-2 rounded-full bg-accent-light px-2 py-0.5 text-xs text-accent">Default</span>}
                {p.isActive === false && <span className="ml-2 text-xs text-ink-muted">Inactive</span>}
              </div>
              <div className="text-xs text-ink-muted">
                Fee {describe(p)} · refunds: {p.refundFeePolicy === 'proportional' ? 'fee given back in proportion' : 'fee kept'}
                {p.refundChargeMethod && p.refundChargeMethod !== 'none' && (
                  <> · refund charge {describe({ ...p, feeMethod: p.refundChargeMethod as any, feePercent: p.refundChargePercent, feeFixed: p.refundChargeFixed })}</>
                )}
              </div>
            </div>
            {canManage && (
              <Button variant="secondary" size="sm" onClick={() => start(p)}>Edit</Button>
            )}
          </div>
        ))}
      </div>

      {canManage && editing === null && (
        <Button onClick={() => start()}>Add card provider</Button>
      )}

      {canManage && editing !== null && (
        <div className="space-y-3 rounded-card border border-border p-4">
          <Input label="Provider name" value={draft.name} onChange={(e: any) => patch({ name: e.target.value })} />
          <BankAccountSelect
            label="Settles into bank account"
            value={draft.bankAccountId}
            onChange={(id) => patch({ bankAccountId: id })}
          />
          <Select
            label="Fee"
            value={draft.feeMethod}
            onChange={(v: any) => patch({ feeMethod: v })}
            options={METHODS}
          />
          <div className="grid gap-3 sm:grid-cols-2">
            {usesPercent(draft.feeMethod) && (
              <Input label="Percentage (%)" type="number" min={0} max={100} step="0.01"
                value={draft.feePercent} onChange={(e: any) => patch({ feePercent: Number(e.target.value) })} />
            )}
            {usesFixed(draft.feeMethod) && (
              <Input label="Fixed amount (AED)" type="number" min={0} step="0.01"
                value={draft.feeFixed} onChange={(e: any) => patch({ feeFixed: Number(e.target.value) })} />
            )}
          </div>
          <Select
            label="On refunds, the original fee"
            value={draft.refundFeePolicy}
            onChange={(v: any) => patch({ refundFeePolicy: v })}
            options={REFUND_POLICY}
          />
          <Select
            label="Extra charge per refund"
            value={draft.refundChargeMethod}
            onChange={(v: any) => patch({ refundChargeMethod: v })}
            options={REFUND_CHARGE}
          />
          <div className="grid gap-3 sm:grid-cols-2">
            {usesPercent(draft.refundChargeMethod) && (
              <Input label="Refund charge (%)" type="number" min={0} max={100} step="0.01"
                value={draft.refundChargePercent} onChange={(e: any) => patch({ refundChargePercent: Number(e.target.value) })} />
            )}
            {usesFixed(draft.refundChargeMethod) && (
              <Input label="Refund charge (AED)" type="number" min={0} step="0.01"
                value={draft.refundChargeFixed} onChange={(e: any) => patch({ refundChargeFixed: Number(e.target.value) })} />
            )}
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={draft.isDefault} onChange={(e) => patch({ isDefault: e.target.checked })} />
            Default provider for card payments
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={draft.isActive} onChange={(e) => patch({ isActive: e.target.checked })} />
            Active
          </label>
          <p className="text-xs text-ink-muted">Changes apply to sales confirmed from now on. Past fees keep the rates they were charged at.</p>
          <div className="flex gap-2">
            <Button onClick={submit} loading={saving}>Save provider</Button>
            <Button variant="secondary" onClick={() => setEditing(null)} disabled={saving}>Cancel</Button>
          </div>
        </div>
      )}
    </div>
  );
}
