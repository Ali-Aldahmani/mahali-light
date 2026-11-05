'use client';

import { useEffect, useState } from 'react';
import Select from '@/components/ui/Select';
import { listPaymentBankAccounts } from '@/services/bankAccountService';

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

export default function BankTenderFields({
  payment,
  onChange,
}: {
  payment: { id: string; bankAccountId?: string | null; reference?: string | null };
  onChange: (patch: { bankAccountId?: string | null; reference?: string | null }) => void;
}) {
  const accounts = usePaymentBankAccounts();
  useEffect(() => {
    if (!payment.bankAccountId && accounts.length) {
      onChange({ bankAccountId: defaultBankAccountId(accounts) });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accounts.length, payment.bankAccountId]);

  return (
    <div className="flex flex-wrap gap-2">
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
