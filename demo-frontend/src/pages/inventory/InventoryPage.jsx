import { useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import {
  Boxes,
  ArrowUpDown,
  ClipboardList,
  Bell,
  History,
} from 'lucide-react';
import PageHeader from '../../components/ui/PageHeader.jsx';
import Tabs from '../../components/ui/Tabs.jsx';
import Button from '../../components/ui/Button.jsx';
import { useInventoryStore } from '../../store/inventoryStore.js';
import StockLevelsTab from './StockLevelsTab.jsx';
import AdjustmentsTab from './AdjustmentsTab.jsx';
import StockCountsTab from './StockCountsTab.jsx';
import AlertsTab from './AlertsTab.jsx';

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

export default function InventoryPage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') || 'levels';

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
            onClick={() => navigate('/inventory/movements')}
          >
            View all movements
          </Button>
        }
      />

      <Tabs
        items={decoratedTabs}
        value={tab}
        onChange={(v) => setParams({ tab: v })}
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
