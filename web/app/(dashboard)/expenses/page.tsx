'use client';

import { useEffect, useState } from 'react';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { Receipt, ShoppingCart, FolderTree, Plus } from 'lucide-react';
import PageHeader from '@/components/ui/PageHeader';
import Tabs from '@/components/ui/Tabs';
import Button from '@/components/ui/Button';
import RequirePermission from '@/components/guards/RequirePermission';
import { useAuthStore } from '@/store/authStore';
import { useBillStore } from '@/store/billStore';
import { onBillEvent, onExpenseEvent } from '@/store/socketStore';
import BillsTab from '@/components/expenses/tabs/BillsTab';
import OneTimeExpensesTab from '@/components/expenses/tabs/OneTimeExpensesTab';
import CategoriesTab from '@/components/expenses/tabs/CategoriesTab';
import BillFormSlideOver from '@/components/bills/BillFormSlideOver';
import AddExpenseSlideOver from '@/components/bills/AddExpenseSlideOver';
import CategoryFormSlideOver from '@/components/bills/CategoryFormSlideOver';

const ALLOWED = ['bills', 'expenses', 'categories'];

function ExpensesPageInner() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const tabFromQuery = searchParams.get('tab');
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const refreshUpcoming = useBillStore((s: any) => s.refreshUpcoming);
  const refreshExpenseSummary = useBillStore((s: any) => s.refreshExpenseSummary);
  const attentionCount = useBillStore((s: any) => s.attentionCount());

  const [tab, setTab] = useState(() =>
    tabFromQuery && ALLOWED.includes(tabFromQuery) ? tabFromQuery : 'bills',
  );
  const [showBillForm, setShowBillForm] = useState(false);
  const [showExpenseForm, setShowExpenseForm] = useState(false);
  const [showCategoryForm, setShowCategoryForm] = useState(false);
  // Bumped after any mutation so child tabs re-fetch on demand.
  const [refreshTick, setRefreshTick] = useState(0);

  useEffect(() => {
    refreshUpcoming();
    refreshExpenseSummary();
  }, [refreshUpcoming, refreshExpenseSummary]);

  useEffect(() => {
    const unsubB = onBillEvent(() => {
      refreshUpcoming();
      setRefreshTick((n) => n + 1);
    });
    const unsubE = onExpenseEvent(() => {
      refreshExpenseSummary();
      setRefreshTick((n) => n + 1);
    });
    return () => {
      unsubB();
      unsubE();
    };
  }, [refreshUpcoming, refreshExpenseSummary]);

  function switchTab(next: string) {
    setTab(next);
    const params = new URLSearchParams(searchParams.toString());
    params.set('tab', next);
    router.replace(`${pathname}?${params.toString()}`);
  }

  function bumpTick() {
    setRefreshTick((n) => n + 1);
    refreshUpcoming();
    refreshExpenseSummary();
  }

  const tabs = [
    {
      value: 'bills',
      label: 'Bills',
      icon: <Receipt size={14} />,
      count: attentionCount || null,
    },
    {
      value: 'expenses',
      label: 'One-time expenses',
      icon: <ShoppingCart size={14} />,
    },
    hasPermission('bills.manage')
      ? {
          value: 'categories',
          label: 'Categories',
          icon: <FolderTree size={14} />,
        }
      : null,
  ].filter(Boolean) as { value: string; label: string; icon: React.ReactNode; count?: number | null }[];

  const action = (() => {
    if (tab === 'bills' && hasPermission('bills.manage')) {
      return (
        <Button leftIcon={<Plus size={16} />} onClick={() => setShowBillForm(true)}>
          Add bill
        </Button>
      );
    }
    if (tab === 'expenses' && hasPermission('bills.pay')) {
      return (
        <Button
          leftIcon={<Plus size={16} />}
          onClick={() => setShowExpenseForm(true)}
        >
          Add expense
        </Button>
      );
    }
    if (tab === 'categories' && hasPermission('bills.manage')) {
      return (
        <Button
          leftIcon={<Plus size={16} />}
          onClick={() => setShowCategoryForm(true)}
        >
          Add category
        </Button>
      );
    }
    return null;
  })();

  return (
    <div>
      <PageHeader
        title="Bills & Expenses"
        subtitle="Recurring bills, one-time expenses and category management."
        action={action}
      />
      <Tabs items={tabs} value={tab} onChange={switchTab} className="mb-6" />

      {tab === 'bills' && (
        <BillsTab
          refreshTick={refreshTick}
          onAddBill={() => setShowBillForm(true)}
          onMutated={bumpTick}
        />
      )}
      {tab === 'expenses' && (
        <OneTimeExpensesTab
          refreshTick={refreshTick}
          onAdd={() => setShowExpenseForm(true)}
          onMutated={bumpTick}
        />
      )}
      {tab === 'categories' && hasPermission('bills.manage') && (
        <CategoriesTab refreshTick={refreshTick} onMutated={bumpTick} />
      )}

      <BillFormSlideOver
        open={showBillForm}
        onClose={() => setShowBillForm(false)}
        onSaved={bumpTick}
      />
      <AddExpenseSlideOver
        open={showExpenseForm}
        onClose={() => setShowExpenseForm(false)}
        onSaved={bumpTick}
      />
      <CategoryFormSlideOver
        open={showCategoryForm}
        onClose={() => setShowCategoryForm(false)}
        onSaved={bumpTick}
      />
    </div>
  );
}

export default function ExpensesPage() {
  return (
    <RequirePermission permission="bills.view">
      <ExpensesPageInner />
    </RequirePermission>
  );
}
