'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import {
  LayoutDashboard,
  LineChart,
  Scale,
  ArrowLeftRight,
  Percent,
} from 'lucide-react';
import PageHeader from '@/components/ui/PageHeader';
import Tabs from '@/components/ui/Tabs';
import RequirePermission from '@/components/guards/RequirePermission';
import { useAuthStore } from '@/store/authStore';
import DashboardTab from '@/components/finance/tabs/DashboardTab';
import PLTab from '@/components/finance/tabs/PLTab';
import BalanceSheetTab from '@/components/finance/tabs/BalanceSheetTab';
import CashFlowTab from '@/components/finance/tabs/CashFlowTab';
import VATTab from '@/components/finance/tabs/VATTab';

const ALLOWED = ['dashboard', 'pl', 'balance-sheet', 'cash-flow', 'vat'];

function FinancePageInner() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const tabFromQuery = searchParams.get('tab');
  const hasPermission = useAuthStore((s) => s.hasPermission);

  const tabs = useMemo(
    () =>
      [
        hasPermission('finance.view_dashboard')
          ? { value: 'dashboard', label: 'Dashboard', icon: <LayoutDashboard size={14} /> }
          : null,
        hasPermission('finance.view_pl')
          ? { value: 'pl', label: 'P&L', icon: <LineChart size={14} /> }
          : null,
        hasPermission('finance.view_balance_sheet')
          ? { value: 'balance-sheet', label: 'Balance Sheet', icon: <Scale size={14} /> }
          : null,
        hasPermission('finance.view_cashflow')
          ? { value: 'cash-flow', label: 'Cash Flow', icon: <ArrowLeftRight size={14} /> }
          : null,
        hasPermission('finance.view_vat')
          ? { value: 'vat', label: 'VAT Report', icon: <Percent size={14} /> }
          : null,
      ].filter(Boolean) as { value: string; label: string; icon: React.ReactNode }[],
    [hasPermission],
  );

  const [tab, setTab] = useState(() => {
    if (tabFromQuery && ALLOWED.includes(tabFromQuery) && tabs.find((t) => t.value === tabFromQuery)) {
      return tabFromQuery;
    }
    return tabs[0]?.value || 'dashboard';
  });

  useEffect(() => {
    if (!tabs.find((t) => t.value === tab)) {
      setTab(tabs[0]?.value || 'dashboard');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabs, tab]);

  function switchTab(next: string) {
    setTab(next);
    const params = new URLSearchParams(searchParams.toString());
    params.set('tab', next);
    router.replace(`${pathname}?${params.toString()}`);
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Finance"
        subtitle="P&L, balance sheet, cash flow, VAT — all live from the journal."
      />
      <Tabs items={tabs} value={tab} onChange={switchTab} />
      {tab === 'dashboard' && <DashboardTab />}
      {tab === 'pl' && <PLTab />}
      {tab === 'balance-sheet' && <BalanceSheetTab />}
      {tab === 'cash-flow' && <CashFlowTab />}
      {tab === 'vat' && <VATTab />}
    </div>
  );
}

export default function FinancePage() {
  return (
    <RequirePermission permission="finance.view_dashboard">
      <FinancePageInner />
    </RequirePermission>
  );
}
