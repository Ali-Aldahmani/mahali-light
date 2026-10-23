'use client';

import { useEffect, useRef, useState } from 'react';
import { Search, UserPlus, UserRound } from 'lucide-react';
import Modal from '@/components/ui/Modal';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { createCustomer, searchCustomers } from '@/services/customerService';
import { formatCurrency } from '@/lib/utils/format';
import Skeleton from '@/components/ui/skeleton';
import PhoneField from '@/components/ui/PhoneField';

const PHONE_RE = /^\+?[0-9][0-9\s-]{5,19}$/;

// Find / select / quick-add a customer without leaving the sale. Selecting
// or creating a customer never touches the cart.
export default function CashierCustomerDialog({
  open,
  startInCreate = false,
  canSearch,
  canCreate,
  canViewBalance,
  onClose,
  onSelect,
}: {
  open: boolean;
  startInCreate?: boolean;
  canSearch: boolean;
  canCreate: boolean;
  canViewBalance: boolean;
  onClose: () => void;
  onSelect: (customer: any) => void;
}) {
  const [mode, setMode] = useState<'search' | 'create'>('search');
  const [query, setQuery] = useState('');
  const debounced = useDebouncedValue(query, 250);
  const [results, setResults] = useState<any[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  const [phone, setPhone] = useState('');
  // Set while the typed number is too short or too long for its country.
  const phoneIncomplete = useRef(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const phoneRef = useRef<HTMLInputElement>(null);

  // The new-customer form starts on the phone number.
  useEffect(() => {
    if (!open || mode !== 'create') return undefined;
    const t = setTimeout(() => phoneRef.current?.focus(), 50);
    return () => clearTimeout(t);
  }, [open, mode]);

  useEffect(() => {
    if (!open) return;
    setMode(startInCreate && canCreate ? 'create' : canSearch ? 'search' : 'create');
    setQuery('');
    setResults([]);
    setSearchError(null);
    setPhone('');
    setName('');
    setEmail('');
    setErrors({});
  }, [open, startInCreate, canCreate, canSearch]);

  useEffect(() => {
    if (!open || mode !== 'search' || !canSearch) return;
    const q = debounced.trim();
    if (!q) {
      setResults([]);
      return;
    }
    let cancelled = false;
    setSearching(true);
    setSearchError(null);
    searchCustomers(q, 12)
      .then((rows: any) => !cancelled && setResults(rows || []))
      .catch((err: any) => !cancelled && setSearchError(err?.message || 'Search failed.'))
      .finally(() => !cancelled && setSearching(false));
    return () => {
      cancelled = true;
    };
  }, [debounced, open, mode, canSearch]);

  function validate() {
    const next: Record<string, string> = {};
    const p = phone.trim();
    if (!p) next.phone = 'Phone number is required.';
    else if (phoneIncomplete.current || !PHONE_RE.test(p)) next.phone = 'Enter the full phone number.';
    if (email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) next.email = 'Enter a valid email.';
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function saveAndSelect() {
    if (!validate()) return;
    setSaving(true);
    try {
      const p = phone.trim();
      const created: any = await createCustomer({
        name: name.trim() || p,
        phone: p,
        email: email.trim() || null,
      });
      onSelect(created);
      onClose();
    } catch (err: any) {
      if (err?.status === 409) {
        setErrors({ phone: 'A customer with this phone already exists — search to select them.' });
        if (canSearch) {
          setMode('search');
          setQuery(phone.trim());
        }
      } else {
        setErrors({ form: err?.message || 'Could not create customer.' });
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={saving ? undefined : onClose}
      title={mode === 'create' ? 'New customer' : 'Select customer'}
      size="md"
      footer={
        mode === 'create' ? (
          <>
            {canSearch && (
              <Button variant="secondary" size="touch" onClick={() => setMode('search')} disabled={saving}>
                Back to search
              </Button>
            )}
            <Button size="touch" onClick={saveAndSelect} loading={saving}>
              Save &amp; select
            </Button>
          </>
        ) : (
          <>
            <Button
              variant="secondary"
              size="touch"
              leftIcon={<UserRound className="h-4 w-4" />}
              onClick={() => {
                onSelect(null);
                onClose();
              }}
            >
              Guest
            </Button>
            {canCreate && (
              <Button size="touch" leftIcon={<UserPlus className="h-4 w-4" />} onClick={() => setMode('create')}>
                New customer
              </Button>
            )}
          </>
        )
      }
    >
      {mode === 'search' ? (
        <div className="space-y-3">
          <Input
            ref={searchRef}
            autoFocus
            label="Search by name or phone"
            value={query}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setQuery(e.target.value)}
            leftIcon={<Search className="h-4 w-4" />}
            placeholder="e.g. 050 123 4567"
            className="h-12 text-base"
          />
          {searchError && <p role="alert" className="text-sm text-error">{searchError}</p>}
          <ul className="max-h-[45vh] space-y-1.5 overflow-y-auto" aria-label="Customer results">
            {searching && (
              <li className="px-1 py-3">
                <Skeleton lines={3} avatar label="Searching customers" />
              </li>
            )}
            {!searching && query.trim() && results.length === 0 && !searchError && (
              <li className="py-4 text-center text-sm text-ink-muted">No customers found.</li>
            )}
            {results.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => {
                    onSelect(c);
                    onClose();
                  }}
                  className="flex min-h-12 w-full items-center justify-between gap-3 rounded-input border border-border px-3 py-2 text-left hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-ink">{c.name}</span>
                    <span className="block truncate text-xs text-ink-muted">
                      {[c.phone, c.companyName].filter(Boolean).join(' · ') || '—'}
                    </span>
                  </span>
                  {canViewBalance && c.creditBalance != null && Number(c.creditBalance) > 0 && (
                    <span className="shrink-0 text-xs font-medium text-warning">
                      Owes {formatCurrency(c.creditBalance)}
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            saveAndSelect();
          }}
        >
          <PhoneField
            ref={phoneRef}
            label="Phone"
            required
            value={phone}
            onChange={(next, details) => {
              phoneIncomplete.current = !!next && !details?.valid;
              setPhone(next);
            }}
            error={errors.phone}
          />
          <Input
            label="Name"
            value={name}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setName(e.target.value)}
            placeholder="Optional — phone is used if empty"
            className="h-12 text-base"
          />
          <Input
            label="Email"
            type="email"
            inputMode="email"
            value={email}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEmail(e.target.value)}
            error={errors.email}
            placeholder="Optional"
            className="h-12 text-base"
          />
          {errors.form && <p role="alert" className="text-sm text-error">{errors.form}</p>}
          <button type="submit" hidden aria-hidden tabIndex={-1} />
        </form>
      )}
    </Modal>
  );
}
