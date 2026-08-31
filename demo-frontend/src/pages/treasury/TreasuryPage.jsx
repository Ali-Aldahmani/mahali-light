import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Banknote,
  Building2,
  Coins,
  ArrowLeftRight,
  LayoutDashboard,
} from 'lucide-react';
import PageHeader from '../../components/ui/PageHeader.jsx';
import Tabs from '../../components/ui/Tabs.jsx';
import { useAuthStore } from '../../store/authStore.js';
import { useTreasuryStore } from '../../store/treasuryStore.js';
import { onTreasuryEvent } from '../../store/socketStore.js';
import OverviewTab from './tabs/OverviewTab.jsx';
import CashDrawerTab from './tabs/CashDrawerTab.jsx';
import BankAccountsTab from './tabs/BankAccountsTab.jsx';
import TransfersTab from './tabs/TransfersTab.jsx';

export default function TreasuryPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const tabFromQuery = searchParams.get('tab');
  const refresh = useTreasuryStore((s) => s.refresh);
  const applyCashEvent = useTreasuryStore((s) => s.applyCashEvent);
  const applyBankEvent = useTreasuryStore((s) => s.applyBankEvent);
  const user = useAuthStore((s) => s.user);
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const [tab, setTab] = useState(() => {
    const allowed = ['overview', 'cash', 'banks', 'transfers'];
    return allowed.includes(tabFromQuery) ? tabFromQuery : 'overview';
  });

  useEffect(() => {
    if (user) refresh();
  }, [user, refresh]);

  useEffect(
    () =>
      onTreasuryEvent((payload) => {
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

  function switchTab(next) {
    setTab(next);
    const params = new URLSearchParams(searchParams);
    params.set('tab', next);
    params.delete('action');
    setSearchParams(params, { replace: true });
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
  ].filter(Boolean);

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
