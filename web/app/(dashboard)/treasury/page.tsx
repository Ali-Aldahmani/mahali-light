'use client';

import { useEffect, useState } from 'react';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import {
  Building2,
  Coins,
  ArrowLeftRight,
  LayoutDashboard,
} from 'lucide-react';
import PageHeader from '@/components/ui/PageHeader';
import Tabs from '@/components/ui/Tabs';
import RequirePermission from '@/components/guards/RequirePermission';
import { useAuthStore } from '@/store/authStore';
import { useTreasuryStore } from '@/store/treasuryStore';
import { onTreasuryEvent } from '@/store/socketStore';
import OverviewTab from '@/components/treasury/tabs/OverviewTab';
import CashDrawerTab from '@/components/treasury/tabs/CashDrawerTab';
import BankAccountsTab from '@/components/treasury/tabs/BankAccountsTab';
import TransfersTab from '@/components/treasury/tabs/TransfersTab';

const ALLOWED_TABS = ['overview', 'cash', 'banks', 'transfers'];

function TreasuryPageInner() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const tabFromQuery = searchParams.get('tab');
  const refresh = useTreasuryStore((s) => s.refresh);
  const applyCashEvent = useTreasuryStore((s) => s.applyCashEvent);
  const applyBankEvent = useTreasuryStore((s) => s.applyBankEvent);
  const user = useAuthStore((s) => s.user);
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const [tab, setTab] = useState(() =>
    tabFromQuery && ALLOWED_TABS.includes(tabFromQuery) ? tabFromQuery : 'overview',
  );

  useEffect(() => {
    if (user) refresh();
  }, [user, refresh]);

  useEffect(
    () =>
      onTreasuryEvent((payload: { kind: string }) => {
        if (payload.kind === 'cash_balance') applyCashEvent(payload);
        if (payload.kind === 'bank_balance') applyBankEvent(payload);
        if (
          payload.kind === 'drawer_opened' ||
          payload.kind === 'drawer_closed'
        ) {
          refresh();
        }
      }),
    [refresh, applyCashEvent, applyBankEvent],
  );

  function switchTab(next: string) {
    setTab(next);
    const params = new URLSearchParams(searchParams.toString());
    params.set('tab', next);
    params.delete('action');
    router.replace(`${pathname}?${params.toString()}`);
  }

  const tabs = [
    { value: 'overview', label: 'Overview', icon: <LayoutDashboard size={14} /> },
    hasPermission('cash.view')
      ? { value: 'cash', label: 'Cash drawer', icon: <Coins size={14} /> }
      : null,
    hasPermission('bank.view')
      ? { value: 'banks', label: 'Bank accounts', icon: <Building2 size={14} /> }
      : null,
    hasPermission('cash.adjust') || hasPermission('bank.transact')
      ? { value: 'transfers', label: 'Transfers', icon: <ArrowLeftRight size={14} /> }
      : null,
  ].filter(Boolean) as { value: string; label: string; icon: React.ReactNode }[];

  return (
    <div className="p-8">
      <PageHeader
        title="Treasury"
        subtitle="Cash drawer, bank accounts, transfers and the live net position."
      />
      <Tabs items={tabs} value={tab} onChange={switchTab} className="mb-6" />

      {tab === 'overview' && <OverviewTab onJumpTab={switchTab} />}
      {tab === 'cash' && (
        <CashDrawerTab actionParam={searchParams.get('action')} />
      )}
      {tab === 'banks' && <BankAccountsTab />}
      {tab === 'transfers' && <TransfersTab />}
    </div>
  );
}

export default function TreasuryPage() {
  return (
    <RequirePermission permission="cash.view">
      <TreasuryPageInner />
    </RequirePermission>
  );
}
