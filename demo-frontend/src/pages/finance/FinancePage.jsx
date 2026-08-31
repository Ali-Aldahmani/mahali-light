import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  LayoutDashboard,
  LineChart,
  Scale,
  ArrowLeftRight,
  Percent,
} from 'lucide-react';
import PageHeader from '../../components/ui/PageHeader.jsx';
import Tabs from '../../components/ui/Tabs.jsx';
import { useAuthStore } from '../../store/authStore.js';
import DashboardTab from './tabs/DashboardTab.jsx';
import PLTab from './tabs/PLTab.jsx';
import BalanceSheetTab from './tabs/BalanceSheetTab.jsx';
import CashFlowTab from './tabs/CashFlowTab.jsx';
import VATTab from './tabs/VATTab.jsx';

const ALLOWED = ['dashboard', 'pl', 'balance-sheet', 'cash-flow', 'vat'];

export default function FinancePage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const tabFromQuery = searchParams.get('tab');
  const hasPermission = useAuthStore((s) => s.hasPermission);

  const tabs = useMemo(
    () =>
      [
        hasPermission('finance.view_dashboard')
          ? { value: 'dashboard',   label: 'Dashboard',     icon: <LayoutDashboard size={14} /> }
          : null,
        hasPermission('finance.view_pl')
          ? { value: 'pl',          label: 'P&L',           icon: <LineChart size={14} /> }
          : null,
        hasPermission('finance.view_balance_sheet')
          ? { value: 'balance-sheet', label: 'Balance Sheet', icon: <Scale size={14} /> }
          : null,
        hasPermission('finance.view_cashflow')
          ? { value: 'cash-flow',   label: 'Cash Flow',     icon: <ArrowLeftRight size={14} /> }
          : null,
        hasPermission('finance.view_vat')
          ? { value: 'vat',         label: 'VAT Report',    icon: <Percent size={14} /> }
          : null,
      ].filter(Boolean),
    [hasPermission],
  );

  const [tab, setTab] = useState(() => {
    if (ALLOWED.includes(tabFromQuery) && tabs.find((t) => t.value === tabFromQuery)) {
      return tabFromQuery;
    }
    return tabs[0]?.value || 'dashboard';
  });

  useEffect(() => {
    if (!tabs.find((t) => t.value === tab)) {
      setTab(tabs[0]?.value || 'dashboard');
    }
  }, [tabs, tab]);

  function switchTab(next) {
    setTab(next);
    const params = new URLSearchParams(searchParams);
    params.set('tab', next);
    setSearchParams(params, { replace: true });
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Finance"
        subtitle="P&L, balance sheet, cash flow, VAT — all live from the journal."
      />
      <Tabs items={tabs} value={tab} onChange={switchTab} />
      {tab === 'dashboard'     && <DashboardTab />}
      {tab === 'pl'            && <PLTab />}
      {tab === 'balance-sheet' && <BalanceSheetTab />}
      {tab === 'cash-flow'     && <CashFlowTab />}
      {tab === 'vat'           && <VATTab />}
    </div>
  );
}
