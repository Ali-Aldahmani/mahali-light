'use client';

import { useEffect } from 'react';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import {
  Boxes,
  ArrowUpDown,
  ClipboardList,
  Bell,
  History,
} from 'lucide-react';
import PageHeader from '@/components/ui/PageHeader';
import Tabs from '@/components/ui/Tabs';
import Button from '@/components/ui/Button';
import RequirePermission from '@/components/guards/RequirePermission';
import { useInventoryStore } from '@/store/inventoryStore';
import StockLevelsTab from '@/components/inventory/StockLevelsTab';
import AdjustmentsTab from '@/components/inventory/AdjustmentsTab';
import StockCountsTab from '@/components/inventory/StockCountsTab';
import AlertsTab from '@/components/inventory/AlertsTab';

const TABS = [
  { value: 'levels', label: 'Stock levels', icon: <Boxes className="h-4 w-4" /> },
  {
    value: 'adjustments',
    label: 'Adjustments',
    icon: <ArrowUpDown className="h-4 w-4" />,
  },
  {
    value: 'counts',
    label: 'Stock counts',
    icon: <ClipboardList className="h-4 w-4" />,
  },
  { value: 'alerts', label: 'Alerts', icon: <Bell className="h-4 w-4" /> },
];

function InventoryPageContent() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const tab = searchParams.get('tab') || 'levels';

  function updateParams(patch: Record<string, string | null>) {
    const next = new URLSearchParams(searchParams.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v === null) next.delete(k);
      else next.set(k, v);
    }
    router.replace(`${pathname}?${next.toString()}`);
  }

  const pendingAdjustments = useInventoryStore((s) => s.pendingAdjustmentsCount);
  const pendingReorderAlerts = useInventoryStore((s) => s.pendingReorderAlerts);
  const refreshAll = useInventoryStore((s) => s.refreshAll);

  useEffect(() => {
    refreshAll();
  }, [refreshAll]);

  const decoratedTabs = TABS.map((t) => {
    if (t.value === 'adjustments' && pendingAdjustments)
      return { ...t, count: pendingAdjustments };
    if (t.value === 'alerts' && pendingReorderAlerts?.length)
      return { ...t, count: pendingReorderAlerts.length };
    return t;
  });

  return (
    <div className="space-y-5">
      <PageHeader
        title="Inventory"
        subtitle="Monitor stock levels, run counts, and act on reorder alerts."
        action={
          <Button
            variant="secondary"
            leftIcon={<History className="h-4 w-4" />}
            onClick={() => router.push('/inventory/movements')}
          >
            View all movements
          </Button>
        }
      />

      <Tabs
        items={decoratedTabs}
        value={tab}
        onChange={(v: string) => updateParams({ tab: v })}
      />

      <div>
        {tab === 'levels' && <StockLevelsTab />}
        {tab === 'adjustments' && <AdjustmentsTab />}
        {tab === 'counts' && <StockCountsTab />}
        {tab === 'alerts' && <AlertsTab />}
      </div>
    </div>
  );
}

export default function InventoryPage() {
  return (
    <RequirePermission permission="stock.view">
      <InventoryPageContent />
    </RequirePermission>
  );
}
