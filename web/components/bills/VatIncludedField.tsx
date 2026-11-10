'use client';

import { useEffect } from 'react';
import Input from '../ui/Input';
import { useAppSettingsStore } from '@/store/appSettingsStore';

const round2 = (n: number) => Math.round(n * 100) / 100;

// The recoverable input VAT inside an amount paid VAT included. The server
// posts it to VAT payable (2002) instead of the expense, and refuses it while
// VAT is switched off in Settings.
export function vatInside(amount: number, rate: number) {
  return rate > 0 && amount > 0 ? round2((amount * rate) / (100 + rate)) : 0;
}

export default function VatIncludedField({
  amount,
  value,
  onChange,
}: {
  amount: string | number;
  value: string;
  onChange: (v: string) => void;
}) {
  const settings = useAppSettingsStore((s) => s.settings);
  const fetchSettings = useAppSettingsStore((s) => s.fetch);
  useEffect(() => {
    if (!settings) fetchSettings().catch(() => {});
  }, [settings, fetchSettings]);
  if (settings && settings.vat_enabled === false) return null;
  const rate = Number(settings?.vat_rate ?? 5) || 0;
  const amt = Number(amount) || 0;
  return (
    <div className="space-y-1">
      <Input
        label="VAT included (AED)"
        type="number"
        min="0"
        step="0.01"
        value={value}
        onChange={(e: any) => onChange(e.target.value)}
        placeholder="0.00"
      />
      <div className="flex flex-wrap items-center gap-2 text-xs text-ink-muted">
        <span>Recoverable VAT on the supplier&apos;s tax invoice. Leave empty if there is none.</span>
        {rate > 0 && amt > 0 && (
          <button type="button" className="text-accent hover:underline" onClick={() => onChange(String(vatInside(amt, rate)))}>
            Use {rate}% ({vatInside(amt, rate).toFixed(2)})
          </button>
        )}
      </div>
    </div>
  );
}
