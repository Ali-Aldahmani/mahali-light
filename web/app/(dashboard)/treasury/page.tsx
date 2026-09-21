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
  // /treasury/summary (Overview's data source) requires cash.view server-side
  // — a role with only e.g. bank.view landing here by default would get a
  // 403 on load. Default to a tab the user can actually see.
  const defaultTab = hasPermission('cash.view')
    ? 'overview'
    : hasPermission('bank.view')
      ? 'banks'
      : hasPermission('cash.adjust') || hasPermission('bank.transact')
        ? 'transfers'
        : 'overview';
  const [tab, setTab] = useState(() =>
    tabFromQuery && ALLOWED_TABS.includes(tabFromQuery) ? tabFromQuery : defaultTab,
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
    hasPermission('cash.view')
      ? { value: 'overview', label: 'Overview', icon: <LayoutDashboard size={14} /> }
      : null,
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

      {tab === 'overview' && hasPermission('cash.view') && <OverviewTab onJumpTab={switchTab} />}
      {tab === 'cash' && hasPermission('cash.view') && (
        <CashDrawerTab actionParam={searchParams.get('action')} />
      )}
      {tab === 'banks' && hasPermission('bank.view') && <BankAccountsTab />}
      {tab === 'transfers' &&
        (hasPermission('cash.adjust') || hasPermission('bank.transact')) && <TransfersTab />}
    </div>
  );
}

// Matches the union of what each tab below individually requires — a
// custom role granted only e.g. bank.view (no cash.view) must still reach
// the page to see the tab it actually has rights to.
const TREASURY_PAGE_PERMISSIONS = ['cash.view', 'bank.view', 'cash.adjust', 'bank.transact'];

export default function TreasuryPage() {
  return (
    <RequirePermission permissions={TREASURY_PAGE_PERMISSIONS}>
      <TreasuryPageInner />
    </RequirePermission>
  );
}
