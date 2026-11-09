'use client';

import { useEffect, useState } from 'react';
import Select from '@/components/ui/Select';
import { listPaymentBankAccounts } from '@/services/bankAccountService';
import { listPaymentProviders, type PaymentProvider } from '@/services/paymentProviderService';

// Card and bank transfer are separate tenders, and each names the bank
// account the money goes to (sales audit SI-03). The till remembers the last
// account it used.

export const BANK_TENDERS = new Set(['card', 'transfer']);
export const isBankTender = (method: string) => BANK_TENDERS.has(method);

const LAST_ACCOUNT_KEY = 'mahali.lastPaymentBankAccount';

type Account = { id: string; bankName: string; accountName: string; isDefault: boolean };

let cached: Promise<Account[]> | null = null;
function loadAccounts(): Promise<Account[]> {
  if (!cached) {
    cached = listPaymentBankAccounts().catch((err) => {
      cached = null;
      throw err;
    });
  }
  return cached;
}

let cachedProviders: Promise<PaymentProvider[]> | null = null;
function loadProviders(): Promise<PaymentProvider[]> {
  if (!cachedProviders) {
    cachedProviders = listPaymentProviders().then((r: any) => r || []).catch((err) => {
      cachedProviders = null;
      throw err;
    });
  }
  return cachedProviders;
}

// Card providers set up under Finance settings. Empty when there are none
// (or the user can't list them), and then no provider is asked for.
export function usePaymentProviders() {
  const [providers, setProviders] = useState<PaymentProvider[]>([]);
  useEffect(() => {
    let live = true;
    loadProviders().then((p) => { if (live) setProviders(p); }).catch(() => {});
    return () => { live = false; };
  }, []);
  return providers;
}

export function rememberedBankAccount(): string | null {
  try {
    return localStorage.getItem(LAST_ACCOUNT_KEY);
  } catch (_e) {
    return null;
  }
}

function remember(id: string) {
  try {
    localStorage.setItem(LAST_ACCOUNT_KEY, id);
  } catch (_e) {
    // per-till convenience only
  }
}

export function usePaymentBankAccounts() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  useEffect(() => {
    let live = true;
    loadAccounts().then((a) => { if (live) setAccounts(a); }).catch(() => {});
    return () => { live = false; };
  }, []);
  return accounts;
}

// The account a new card/transfer row starts with: the till's last one if it
// still exists, else the default account.
export function defaultBankAccountId(accounts: Account[]): string | null {
  const last = rememberedBankAccount();
  if (last && accounts.some((a) => a.id === last)) return last;
  return accounts.find((a) => a.isDefault)?.id || accounts[0]?.id || null;
}

// Just the account, for screens with no slip reference (collections, refunds,
// supplier payments). Starts on the till's last account, else the default.
export function BankAccountSelect({
  value,
  onChange,
  label = 'Bank account',
}: {
  value: string | null | undefined;
  onChange: (id: string | null) => void;
  label?: string;
}) {
  const accounts = usePaymentBankAccounts();
  useEffect(() => {
    if (!value && accounts.length) onChange(defaultBankAccountId(accounts));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accounts.length, value]);
  return (
    <Select
      label={label}
      required
      placeholder={accounts.length ? 'Bank account' : 'No bank account set up'}
      value={value || ''}
      onChange={(v) => {
        if (v) remember(v);
        onChange(v || null);
      }}
      options={accounts.map((a) => ({ value: a.id, label: `${a.bankName} · ${a.accountName}` }))}
    />
  );
}

type TenderPatch = { bankAccountId?: string | null; reference?: string | null; providerId?: string | null };

export default function BankTenderFields({
  payment,
  onChange,
}: {
  payment: { id: string; method?: string; bankAccountId?: string | null; reference?: string | null; providerId?: string | null };
  onChange: (patch: TenderPatch) => void;
}) {
  const accounts = usePaymentBankAccounts();
  const providers = usePaymentProviders();
  const isCard = payment.method === 'card';
  useEffect(() => {
    if (!payment.bankAccountId && accounts.length) {
      onChange({ bankAccountId: defaultBankAccountId(accounts) });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accounts.length, payment.bankAccountId]);
  useEffect(() => {
    if (isCard && !payment.providerId && providers.length) {
      onChange({ providerId: (providers.find((p) => p.isDefault) || providers[0]).id });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isCard, providers.length, payment.providerId]);

  return (
    <div className="flex flex-wrap gap-2">
      {isCard && providers.length > 0 && (
        <Select
          containerClassName="min-w-[10rem] flex-1"
          placeholder="Card provider"
          value={payment.providerId || ''}
          onChange={(v) => onChange({ providerId: v || null })}
          options={providers.map((p) => ({ value: p.id, label: p.name }))}
          aria-label="Card provider"
        />
      )}
      <Select
        containerClassName="min-w-[12rem] flex-1"
        placeholder={accounts.length ? 'Bank account' : 'No bank account set up'}
        value={payment.bankAccountId || ''}
        onChange={(v) => {
          if (v) remember(v);
          onChange({ bankAccountId: v || null });
        }}
        options={accounts.map((a) => ({ value: a.id, label: `${a.bankName} · ${a.accountName}` }))}
        aria-label="Bank account"
      />
      <input
        id={`payment-reference-${payment.id}`}
        type="text"
        maxLength={100}
        value={payment.reference || ''}
        onChange={(e) => onChange({ reference: e.target.value || null })}
        placeholder="Reference (optional)"
        aria-label="Payment reference"
        className="h-10 min-w-[10rem] flex-1 rounded-input border border-border px-3 text-sm text-ink focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30"
      />
    </div>
  );
}
